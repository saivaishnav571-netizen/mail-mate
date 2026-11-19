"""FastAPI service for human-in-the-loop classification feedback.

The service stores corrections in SQLite, exposes honest analytics, exports
approved feedback as CSV, and retrains a scikit-learn pipeline only when an
administrator asks. Corrections never trigger training by themselves.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

import joblib
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import Settings
from .database import Base, make_engine, make_session_factory
from .ml import (
    ALGORITHMS,
    CATEGORIES,
    DATASET_LABEL,
    DEFAULT_ALGORITHM,
    MODEL_NAME,
    TFIDF_CONFIG,
    compare_models,
    evaluate_pipeline,
    load_seed_samples,
    split_seed_samples,
    train_pipeline,
)
from .models import EmailAnalysisEvent, Feedback, InferenceStat, ModelReport, ModelVersion
from .schemas import (
    AnalyticsOut,
    CategoryCount,
    CountBucket,
    EmailAnalysisBatchIn,
    EmailAnalysisBatchOut,
    EmailAnalyticsOut,
    EmailAnalysisIn,
    EvaluationOut,
    FeedbackCreate,
    FeedbackOut,
    InferenceOut,
    IntelligenceOut,
    ModelComparisonOut,
    ModelInfoOut,
    ModelMetricsOut,
    ModelVersionOut,
    PredictIn,
    PredictOut,
    RetrainResponse,
    StatusOut,
    TimelinePoint,
)

# A pipeline is cached per artifact path + mtime. The cache only avoids
# reloading the same artifact; it never changes evaluation numbers.
_PIPELINE_CACHE: dict[str, tuple[float, object, float]] = {}
# Comparison results are derived from the fixed labelled split. They are kept
# per seed-file mtime so opening the dashboard does not retrain on every view.
_COMPARISON_CACHE: dict[str, tuple[float, dict]] = {}

DISCLOSURES = [
    "Model metrics are measured on a fixed labelled holdout split. Training accuracy is never reported as test accuracy.",
    "Confidence is the model's probability for the label it chose. It is not a guarantee that the label is correct.",
    "User agreement is a human review signal (correct feedback / total feedback). It is not model accuracy.",
    "Model comparison trains the three candidate algorithms on the same split for evaluation only. No candidate is activated automatically.",
    "Email analytics stores aggregate metadata only. Subjects and message bodies are never sent.",
]


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


def _algorithm_meta(algorithm_id: str | None) -> dict:
    for entry in ALGORITHMS:
        if entry["id"] == algorithm_id:
            return entry
    return next(entry for entry in ALGORITHMS if entry["id"] == DEFAULT_ALGORITHM)


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite drops timezone info. Treat stored timestamps as UTC."""
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _record_inference(session: Session, count: int, total_latency_ms: float) -> None:
    """Add real service predictions to the cumulative counters."""
    if count <= 0:
        return
    stat = session.get(InferenceStat, 1)
    if stat is None:
        stat = InferenceStat(id=1, total_predictions=0, total_latency_ms=0.0)
        session.add(stat)
    stat.total_predictions = int(stat.total_predictions) + int(count)
    stat.total_latency_ms = float(stat.total_latency_ms) + float(total_latency_ms)
    stat.updated_at = datetime.now(timezone.utc)


def _load_pipeline(path: Path) -> dict:
    """Load a stored artifact, measuring only the first real load."""
    if not path.exists():
        return {
            "status": "artifact_missing",
            "pipeline": None,
            "load_ms": None,
            "artifact_exists": False,
            "from_cache": False,
        }

    try:
        mtime = path.stat().st_mtime
    except OSError:
        return {
            "status": "artifact_missing",
            "pipeline": None,
            "load_ms": None,
            "artifact_exists": False,
            "from_cache": False,
        }

    cached = _PIPELINE_CACHE.get(str(path))
    if cached and cached[0] == mtime:
        return {
            "status": "loaded",
            "pipeline": cached[1],
            "load_ms": cached[2],
            "artifact_exists": True,
            "from_cache": True,
        }

    started = time.perf_counter()
    try:
        pipeline = joblib.load(path)
    except Exception:
        return {
            "status": "load_failed",
            "pipeline": None,
            "load_ms": None,
            "artifact_exists": True,
            "from_cache": False,
        }

    load_ms = round((time.perf_counter() - started) * 1000.0, 3)
    _PIPELINE_CACHE[str(path)] = (mtime, pipeline, load_ms)
    return {
        "status": "loaded",
        "pipeline": pipeline,
        "load_ms": load_ms,
        "artifact_exists": True,
        "from_cache": False,
    }


def _approved_feedback_samples(session: Session) -> list[dict[str, str]]:
    rows = session.scalars(
        select(Feedback)
        .where(Feedback.approved_for_training.is_(True))
        .order_by(Feedback.id.asc())
    ).all()
    return [
        {"category": row.corrected_category, "text": (row.email_text or "").strip()}
        for row in rows
        if (row.email_text or "").strip() and row.corrected_category in CATEGORIES
    ]


def _feedback_summary(session: Session) -> AnalyticsOut:
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


def _report_for(session: Session, settings: Settings, model: ModelVersion) -> dict | None:
    """Return the stored report, or derive one from the stored artifact.

    Deriving a report evaluates the existing pipeline on the fixed holdout. It
    never fits a new model, so metrics stay tied to the version that produced
    them.
    """
    row = session.scalar(select(ModelReport).where(ModelReport.model_version == model.version))
    if row:
        payload = json.loads(row.payload)
        payload.setdefault("algorithm", DEFAULT_ALGORITHM)
        payload.setdefault("reconstructed", False)
        return payload

    runtime = _load_pipeline(Path(model.artifact_path))
    if runtime["status"] != "loaded" or runtime["pipeline"] is None:
        return None

    _, seed_test = _seed_split(settings)
    evaluation = evaluate_pipeline(runtime["pipeline"], seed_test, DATASET_LABEL)
    payload = {
        "algorithm": DEFAULT_ALGORITHM,
        "metrics": evaluation,
        "reconstructed": True,
    }
    session.add(
        ModelReport(
            model_version=model.version,
            payload=json.dumps(payload),
        )
    )
    predictions = int(evaluation.get("prediction_count", 0))
    _record_inference(
        session,
        predictions,
        float(evaluation.get("latency_ms", 0.0)) * predictions,
    )
    session.commit()
    return payload


def _metrics_out(report: dict) -> ModelMetricsOut:
    metrics = report["metrics"]
    return ModelMetricsOut(
        accuracy=float(metrics["accuracy"]),
        precision_macro=float(metrics["precision_macro"]),
        recall_macro=float(metrics["recall_macro"]),
        macro_f1=float(metrics["macro_f1"]),
        correct=int(metrics["correct"]),
        test_size=int(metrics["test_size"]),
        dataset=str(metrics["dataset"]),
        per_category=metrics["per_category"],
        confusion_matrix=metrics["confusion_matrix"],
        prediction_count=int(metrics.get("prediction_count", metrics["test_size"])),
        latency_ms=float(metrics.get("latency_ms", 0.0)),
        evaluated_at=metrics["evaluated_at"],
    )


def _model_info(model: ModelVersion, report: dict) -> ModelInfoOut:
    meta = _algorithm_meta(report.get("algorithm"))
    metrics = report["metrics"]
    return ModelInfoOut(
        name=MODEL_NAME,
        version=model.version,
        algorithm=meta["name"],
        algorithm_id=meta["id"],
        is_active=model.is_active,
        created_at=_as_utc(model.created_at),
        training_samples=model.training_size,
        test_samples=int(metrics.get("test_size", model.test_size)),
        feedback_samples=model.feedback_count,
        tfidf=TFIDF_CONFIG,
        notes=model.notes,
        reconstructed=bool(report.get("reconstructed", False)),
    )


def _comparison_for(settings: Settings) -> dict:
    key = str(settings.seed_path)
    try:
        mtime = settings.seed_path.stat().st_mtime
    except OSError:
        mtime = 0.0

    cached = _COMPARISON_CACHE.get(key)
    if cached and cached[0] == mtime:
        return cached[1]

    train, test = _seed_split(settings)
    result = compare_models(train, test, DATASET_LABEL)
    _COMPARISON_CACHE[key] = (mtime, result)
    return result


def _email_analytics(session: Session) -> EmailAnalyticsOut:
    total = int(session.scalar(select(func.count(EmailAnalysisEvent.id))) or 0)
    unique = int(
        session.scalar(select(func.count(func.distinct(EmailAnalysisEvent.email_id)))) or 0
    )

    category_counts = {category: 0 for category in CATEGORIES}
    for row in session.execute(
        select(EmailAnalysisEvent.category, func.count(EmailAnalysisEvent.id)).group_by(
            EmailAnalysisEvent.category
        )
    ).all():
        if row[0] in category_counts:
            category_counts[row[0]] = int(row[1])

    priorities = [int(value) for value in session.scalars(select(EmailAnalysisEvent.priority)).all()]
    priority_buckets = [
        ("0–24", 0, 24),
        ("25–49", 25, 49),
        ("50–74", 50, 74),
        ("75–100", 75, 100),
    ]
    priority_distribution = [
        CountBucket(
            label=label,
            count=sum(1 for value in priorities if low <= value <= high),
        )
        for label, low, high in priority_buckets
    ]

    confidences = [float(value) for value in session.scalars(select(EmailAnalysisEvent.confidence)).all()]
    confidence_buckets = [
        ("0–20%", 0.0, 0.2),
        ("20–40%", 0.2, 0.4),
        ("40–60%", 0.4, 0.6),
        ("60–80%", 0.6, 0.8),
        ("80–100%", 0.8, 1.0000001),
    ]
    confidence_distribution = [
        CountBucket(
            label=label,
            count=sum(1 for value in confidences if low <= value < high),
        )
        for label, low, high in confidence_buckets
    ]

    timeline_rows = session.execute(
        select(
            func.date(EmailAnalysisEvent.analyzed_at).label("day"),
            func.count(EmailAnalysisEvent.id),
        )
        .group_by("day")
        .order_by("day")
    ).all()
    timeline = [
        TimelinePoint(date=str(row[0]), count=int(row[1])) for row in timeline_rows if row[0]
    ]

    datasets = sorted(
        str(value)
        for value in session.scalars(
            select(EmailAnalysisEvent.dataset).distinct().order_by(EmailAnalysisEvent.dataset)
        ).all()
        if value
    )

    return EmailAnalyticsOut(
        total_analyzed=total,
        unique_messages=unique,
        category_distribution=[
            CategoryCount(category=category, count=category_counts[category])
            for category in CATEGORIES
        ],
        priority_distribution=priority_distribution,
        confidence_distribution=confidence_distribution,
        timeline=timeline,
        last_analyzed_at=_as_utc(
            session.scalar(select(func.max(EmailAnalysisEvent.analyzed_at)))
        ),
        datasets=datasets,
    )


def _inference_out(session: Session, runtime: dict) -> InferenceOut:
    stat = session.get(InferenceStat, 1)
    total = int(stat.total_predictions) if stat else 0
    total_latency = float(stat.total_latency_ms) if stat else 0.0
    average = round(total_latency / total, 3) if total else 0.0
    return InferenceOut(
        average_latency_ms=average,
        total_predictions=total,
        model_loaded=runtime["status"] == "loaded",
        artifact_exists=bool(runtime["artifact_exists"]),
        model_load_ms=runtime["load_ms"],
        status=runtime["status"],
    )


def _safe_csv_cell(value: str | None) -> str:
    """Neutralize spreadsheet formula prefixes in user-controlled CSV cells."""
    text_value = "" if value is None else str(value)
    probe = text_value.lstrip(" \t\r\n")
    if probe.startswith(("=", "+", "-", "@")):
        return "'" + text_value
    return text_value


def _batch_key(dataset: str, message: EmailAnalysisIn) -> str:
    received = message.received_at.isoformat() if message.received_at else ""
    raw = "|".join(
        [
            dataset,
            message.email_id,
            message.category,
            f"{message.confidence:.6f}",
            "" if message.model_confidence is None else f"{message.model_confidence:.6f}",
            str(message.priority),
            received,
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _softmax(values) -> list[float]:
    ordered = [float(value) for value in values]
    peak = max(ordered)
    exps = [math.exp(value - peak) for value in ordered]
    total = sum(exps) or 1.0
    return [value / total for value in exps]


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
    algorithm: str = DEFAULT_ALGORITHM,
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

    report_payload = {
        "algorithm": algorithm,
        "metrics": evaluation,
        "reconstructed": False,
    }
    session.add(
        ModelReport(
            model_version=version,
            payload=json.dumps(report_payload),
        )
    )
    predictions = int(evaluation.get("prediction_count", 0))
    _record_inference(
        session,
        predictions,
        float(evaluation.get("latency_ms", 0.0)) * predictions,
    )

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
        settings.validate_runtime()
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
        allow_origins=list(settings.allowed_origins),
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
        if not secrets.compare_digest(
            x_admin_token or "", request.app.state.settings.admin_token or ""
        ):
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
        _: None = Depends(require_admin),
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
        return _feedback_summary(session)

    @app.get("/api/intelligence", response_model=IntelligenceOut)
    def intelligence(session: Session = Depends(get_db)) -> IntelligenceOut:
        settings = app.state.settings
        active = _get_active_model(session)
        if not active:
            raise HTTPException(status_code=404, detail="No active model version.")

        runtime = _load_pipeline(Path(active.artifact_path))
        report = _report_for(session, settings, active)
        if report is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Held-out metrics cannot be evaluated because the active model "
                    "artifact is missing or unreadable. Retrain or restore the artifact."
                ),
            )

        comparison = _comparison_for(settings)
        return IntelligenceOut(
            generated_at=datetime.now(timezone.utc),
            model=_model_info(active, report),
            metrics=_metrics_out(report),
            comparison=ModelComparisonOut(**comparison),
            email_analytics=_email_analytics(session),
            feedback=_feedback_summary(session),
            inference=_inference_out(session, runtime),
            disclosures=DISCLOSURES,
        )

    @app.post(
        "/api/emails/analyze",
        response_model=EmailAnalysisBatchOut,
        status_code=status.HTTP_201_CREATED,
    )
    def record_email_analysis(
        payload: EmailAnalysisBatchIn,
        session: Session = Depends(get_db),
    ) -> EmailAnalysisBatchOut:
        stored = 0
        duplicates = 0
        seen: set[str] = set()

        for message in payload.messages:
            key = _batch_key(payload.dataset, message)
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            event = EmailAnalysisEvent(
                batch_key=key,
                email_id=message.email_id,
                category=message.category,
                confidence=float(message.confidence),
                model_confidence=(
                    float(message.model_confidence)
                    if message.model_confidence is not None
                    else None
                ),
                priority=int(message.priority),
                dataset=payload.dataset,
                received_at=message.received_at,
            )
            # The unique constraint is the concurrency-safe source of truth.
            # A savepoint lets duplicate inserts be counted without aborting
            # the rest of this batch transaction.
            try:
                with session.begin_nested():
                    session.add(event)
                    session.flush()
                stored += 1
            except IntegrityError:
                duplicates += 1

        if stored:
            session.commit()

        total = int(session.scalar(select(func.count(EmailAnalysisEvent.id))) or 0)
        return EmailAnalysisBatchOut(
            received=len(payload.messages),
            stored=stored,
            duplicates=duplicates,
            total_analyzed=total,
        )

    @app.post("/api/model/predict", response_model=PredictOut)
    def predict(payload: PredictIn, session: Session = Depends(get_db)) -> PredictOut:
        active = _get_active_model(session)
        if not active:
            raise HTTPException(status_code=404, detail="No active model version.")

        runtime = _load_pipeline(Path(active.artifact_path))
        if runtime["status"] != "loaded" or runtime["pipeline"] is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The active model artifact is missing or could not be loaded.",
            )

        pipeline = runtime["pipeline"]
        classes = [
            str(label) for label in pipeline.named_steps["clf"].classes_
        ]
        started = time.perf_counter()
        try:
            predicted = str(pipeline.predict([payload.text])[0])
            if hasattr(pipeline, "predict_proba"):
                scores = [float(value) for value in pipeline.predict_proba([payload.text])[0]]
            else:
                # Linear SVM exposes decision margins, not calibrated
                # probabilities. A softmax of the margins is reported as a
                # relative confidence score, never as accuracy.
                decision = pipeline.decision_function([payload.text])
                row = decision[0] if getattr(decision, "ndim", 1) > 1 else decision
                scores = _softmax(row)
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The model could not classify this text.",
            ) from exc

        latency_ms = round((time.perf_counter() - started) * 1000.0, 3)
        probabilities = {
            label: round(float(score), 6) for label, score in zip(classes, scores)
        }
        confidence = probabilities.get(predicted)
        if confidence is None:
            confidence = round(max(probabilities.values()), 6)

        _record_inference(session, 1, latency_ms)
        session.commit()

        return PredictOut(
            model_version=active.version,
            predicted_category=predicted,
            confidence=confidence,
            probabilities=probabilities,
            latency_ms=latency_ms,
        )

    @app.get("/api/feedback/export")
    def export_feedback(
        approved_only: bool = True,
        _: None = Depends(require_admin),
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
                    _safe_csv_cell(row.email_id),
                    _safe_csv_cell(row.email_subject),
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
        approved_samples = _approved_feedback_samples(session)

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
