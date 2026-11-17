"""FastAPI service for human-in-the-loop classification feedback.

The service stores corrections in SQLite, exposes honest analytics, exports
approved feedback as CSV, and retrains a scikit-learn pipeline only when an
administrator asks. Corrections never trigger training by themselves.
"""

from __future__ import annotations

import csv
import io
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Iterator

import joblib
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .config import Settings
from .database import Base, make_engine, make_session_factory
from .ml import (
    CATEGORIES,
    evaluate_pipeline,
    load_seed_samples,
    split_seed_samples,
    train_pipeline,
)
from .models import Feedback, ModelVersion
from .schemas import (
    AnalyticsOut,
    CategoryCount,
    EvaluationOut,
    FeedbackCreate,
    FeedbackOut,
    ModelVersionOut,
    RetrainResponse,
    StatusOut,
)


def _get_active_model(session: Session) -> ModelVersion | None:
    return session.scalar(select(ModelVersion).where(ModelVersion.is_active.is_(True)))


def _next_version(session: Session) -> str:
    versions = session.scalars(select(ModelVersion.version)).all()
    highest = 0
    for version in versions:
        match = re.fullmatch(r"v(\d+)", version or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"v{highest + 1}"


def _seed_split(settings: Settings):
    samples = load_seed_samples(settings.seed_path)
    return split_seed_samples(samples)


def _persist_model(
    session: Session,
    settings: Settings,
    *,
    version: str,
    pipeline,
    evaluation: dict,
    training_size: int,
    feedback_count: int,
    notes: str | None,
    active: bool,
) -> ModelVersion:
    settings.model_dir.mkdir(parents=True, exist_ok=True)
    artifact_path = settings.model_dir / f"{version}.joblib"
    joblib.dump(pipeline, artifact_path)

    model = ModelVersion(
        version=version,
        training_size=training_size,
        feedback_count=feedback_count,
        accuracy=float(evaluation["accuracy"]),
        macro_f1=float(evaluation["macro_f1"]),
        test_size=int(evaluation["test_size"]),
        is_active=active,
        artifact_path=str(artifact_path),
        notes=notes,
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return model


def _ensure_initial_model(session: Session, settings: Settings) -> ModelVersion:
    active = _get_active_model(session)
    if active:
        return active

    existing = session.scalar(select(ModelVersion).order_by(ModelVersion.created_at.desc()))
    if existing:
        existing.is_active = True
        session.commit()
        session.refresh(existing)
        return existing

    seed_train, seed_test = _seed_split(settings)
    pipeline, training_size = train_pipeline(seed_train)
    evaluation = evaluate_pipeline(
        pipeline,
        seed_test,
        "fixed labelled holdout from src/lib/ai-training.js",
    )
    return _persist_model(
        session,
        settings,
        version=_next_version(session),
        pipeline=pipeline,
        evaluation=evaluation,
        training_size=training_size,
        feedback_count=0,
        notes="Initial model trained from the existing labelled examples.",
        active=True,
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        engine = make_engine(settings.database_url)
        app.state.engine = engine
        app.state.session_factory = make_session_factory(engine)
        Base.metadata.create_all(engine)
        with app.state.session_factory() as session:
            _ensure_initial_model(session, settings)
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(
        title="MailMate Feedback API",
        version="1.0.0",
        description="Human-in-the-loop classification feedback and manual retraining.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://127.0.0.1:4173",
            "http://localhost:4173",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def no_store_api_responses(request: Request, call_next):
        """Analytics and feedback must never be served from a stale cache."""
        response = await call_next(request)
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def get_db(request: Request) -> Iterator[Session]:
        factory = request.app.state.session_factory
        session = factory()
        try:
            yield session
        finally:
            session.close()

    def require_admin(
        request: Request,
        x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
    ) -> None:
        if x_admin_token != request.app.state.settings.admin_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="A valid X-Admin-Token header is required.",
            )

    @app.get("/api/health", response_model=StatusOut)
    def health(session: Session = Depends(get_db)) -> StatusOut:
        active = _get_active_model(session)
        total = session.scalar(select(func.count(Feedback.id))) or 0
        return StatusOut(
            status="ok",
            active_model=active.version if active else None,
            feedback_count=int(total),
        )

    @app.get("/api/model/current", response_model=ModelVersionOut)
    def current_model(session: Session = Depends(get_db)) -> ModelVersionOut:
        active = _get_active_model(session)
        if not active:
            raise HTTPException(status_code=404, detail="No active model version.")
        return ModelVersionOut.model_validate(active)

    @app.get("/api/model/versions", response_model=list[ModelVersionOut])
    def model_versions(session: Session = Depends(get_db)) -> list[ModelVersionOut]:
        rows = session.scalars(
            select(ModelVersion).order_by(ModelVersion.created_at.desc(), ModelVersion.id.desc())
        ).all()
        return [ModelVersionOut.model_validate(row) for row in rows]

    @app.post("/api/feedback", response_model=FeedbackOut, status_code=status.HTTP_201_CREATED)
    def create_feedback(
        payload: FeedbackCreate,
        session: Session = Depends(get_db),
    ) -> FeedbackOut:
        active = _get_active_model(session)
        model_version = (payload.model_version or (active.version if active else "unversioned")).strip()
        feedback = Feedback(
            email_id=payload.email_id,
            email_subject=payload.email_subject,
            email_text=payload.email_text,
            predicted_category=payload.predicted_category,
            corrected_category=payload.corrected_category,
            original_confidence=payload.original_confidence,
            model_version=model_version,
            feedback_type=payload.feedback_type,
        )
        session.add(feedback)
        session.commit()
        session.refresh(feedback)
        return FeedbackOut.model_validate(feedback)

    @app.get("/api/feedback", response_model=list[FeedbackOut])
    def list_feedback(
        limit: int = 50,
        approved_only: bool = False,
        session: Session = Depends(get_db),
    ) -> list[FeedbackOut]:
        limit = max(1, min(limit, 500))
        query = select(Feedback).order_by(Feedback.created_at.desc(), Feedback.id.desc()).limit(limit)
        if approved_only:
            query = query.where(Feedback.approved_for_training.is_(True))
        rows = session.scalars(query).all()
        return [FeedbackOut.model_validate(row) for row in rows]

    @app.post("/api/feedback/{feedback_id}/approve", response_model=FeedbackOut)
    def approve_feedback(
        feedback_id: int,
        _: None = Depends(require_admin),
        session: Session = Depends(get_db),
    ) -> FeedbackOut:
        feedback = session.get(Feedback, feedback_id)
        if not feedback:
            raise HTTPException(status_code=404, detail="Feedback not found.")
        feedback.approved_for_training = True
        feedback.reviewed_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(feedback)
        return FeedbackOut.model_validate(feedback)

    @app.get("/api/analytics", response_model=AnalyticsOut)
    def analytics(session: Session = Depends(get_db)) -> AnalyticsOut:
        total = int(session.scalar(select(func.count(Feedback.id))) or 0)
        corrected = int(
            session.scalar(
                select(func.count(Feedback.id)).where(Feedback.feedback_type == "incorrect")
            )
            or 0
        )
        approved = int(
            session.scalar(
                select(func.count(Feedback.id)).where(Feedback.approved_for_training.is_(True))
            )
            or 0
        )
        category_rows = session.execute(
            select(Feedback.corrected_category, func.count(Feedback.id).label("count"))
            .where(Feedback.feedback_type == "incorrect")
            .group_by(Feedback.corrected_category)
            .order_by(func.count(Feedback.id).desc(), Feedback.corrected_category.asc())
        ).all()
        active = _get_active_model(session)
        correct = total - corrected
        agreement = round(correct / total, 4) if total else 0.0

        return AnalyticsOut(
            total_feedback=total,
            corrected_predictions=corrected,
            correct_feedback=correct,
            user_agreement_rate=agreement,
            approved_for_training=approved,
            most_frequently_corrected_categories=[
                CategoryCount(category=row[0], count=int(row[1])) for row in category_rows
            ],
            current_model=ModelVersionOut.model_validate(active) if active else None,
            model_accuracy=active.accuracy if active else None,
            model_macro_f1=active.macro_f1 if active else None,
        )

    @app.get("/api/feedback/export")
    def export_feedback(
        approved_only: bool = True,
        session: Session = Depends(get_db),
    ) -> Response:
        query = select(Feedback).order_by(Feedback.created_at.asc(), Feedback.id.asc())
        if approved_only:
            query = query.where(Feedback.approved_for_training.is_(True))
        rows = session.scalars(query).all()

        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(
            [
                "id",
                "email_id",
                "email_subject",
                "predicted_category",
                "corrected_category",
                "original_confidence",
                "model_version",
                "feedback_type",
                "approved_for_training",
                "created_at",
                "reviewed_at",
            ]
        )
        for row in rows:
            writer.writerow(
                [
                    row.id,
                    row.email_id,
                    row.email_subject or "",
                    row.predicted_category,
                    row.corrected_category,
                    f"{row.original_confidence:.4f}",
                    row.model_version,
                    row.feedback_type,
                    str(row.approved_for_training).lower(),
                    row.created_at.isoformat(),
                    row.reviewed_at.isoformat() if row.reviewed_at else "",
                ]
            )

        suffix = "approved" if approved_only else "all"
        filename = f"mailmate-feedback-{suffix}-{datetime.now(timezone.utc):%Y%m%d}.csv"
        return Response(
            content=output.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.post("/api/model/retrain", response_model=RetrainResponse)
    def retrain_model(
        _: None = Depends(require_admin),
        session: Session = Depends(get_db),
    ) -> RetrainResponse:
        settings = app.state.settings
        seed_train, seed_test = _seed_split(settings)
        approved_rows = session.scalars(
            select(Feedback)
            .where(Feedback.approved_for_training.is_(True))
            .order_by(Feedback.id.asc())
        ).all()
        approved_samples = [
            {"category": row.corrected_category, "text": (row.email_text or "").strip()}
            for row in approved_rows
            if (row.email_text or "").strip() and row.corrected_category in CATEGORIES
        ]

        pipeline, training_size = train_pipeline(seed_train, approved_samples)
        evaluation = evaluate_pipeline(
            pipeline,
            seed_test,
            "fixed labelled holdout from src/lib/ai-training.js",
        )
        active_before = _get_active_model(session)
        version = _next_version(session)
        candidate = _persist_model(
            session,
            settings,
            version=version,
            pipeline=pipeline,
            evaluation=evaluation,
            training_size=training_size,
            feedback_count=len(approved_samples),
            notes=(
                f"Manual retrain with {len(approved_samples)} approved feedback sample(s). "
                "Stored inactive until an administrator activates it."
            ),
            active=False,
        )
        recommended = active_before is None or float(evaluation["macro_f1"]) >= active_before.macro_f1

        return RetrainResponse(
            candidate=ModelVersionOut.model_validate(candidate),
            active_before=ModelVersionOut.model_validate(active_before) if active_before else None,
            feedback_used=len(approved_samples),
            training_samples=training_size,
            evaluation=EvaluationOut(**evaluation),
            recommended=recommended,
        )

    @app.post("/api/model/{version}/activate", response_model=ModelVersionOut)
    def activate_model(
        version: str,
        _: None = Depends(require_admin),
        session: Session = Depends(get_db),
    ) -> ModelVersionOut:
        model = session.scalar(select(ModelVersion).where(ModelVersion.version == version))
        if not model:
            raise HTTPException(status_code=404, detail="Model version not found.")
        session.execute(update(ModelVersion).values(is_active=False))
        model.is_active = True
        session.commit()
        session.refresh(model)
        return ModelVersionOut.model_validate(model)

    return app


app = create_app()
