"""Shared test fixtures. Each test gets an isolated SQLite database."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.config import Settings  # noqa: E402
from backend.app.main import create_app  # noqa: E402

ADMIN_TOKEN = "test-admin-token-0123456789abcdef0123456789abcdef"
SEED_PATH = Path(__file__).resolve().parents[1] / "app" / "seed_data.json"


@pytest.fixture()
def client(tmp_path):
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'mailmate-test.db').as_posix()}",
        data_dir=tmp_path,
        admin_token=ADMIN_TOKEN,
        seed_path=SEED_PATH,
    )
    app = create_app(settings)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def admin_headers():
    return {"X-Admin-Token": ADMIN_TOKEN}


def feedback_payload(
    *,
    email_id: str = "finance-budget-01",
    predicted: str = "important",
    corrected: str | None = None,
    feedback_type: str = "correct",
    confidence: float = 0.82,
):
    payload = {
        "email_id": email_id,
        "email_subject": "Budget forecast: numbers due Friday",
        "email_text": "The quarterly budget forecast is due Friday. Please upload the revised figures.",
        "predicted_category": predicted,
        "original_confidence": confidence,
        "feedback_type": feedback_type,
    }
    if corrected is not None:
        payload["corrected_category"] = corrected
    return payload
