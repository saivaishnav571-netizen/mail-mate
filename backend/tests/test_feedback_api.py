"""API and database tests for the human-in-the-loop feedback service."""

from __future__ import annotations

import csv
import io

ADMIN_TOKEN = "test-admin-token-0123456789abcdef0123456789abcdef"


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


def post_feedback(client, **overrides):
    payload = feedback_payload(**overrides)
    response = client.post("/api/feedback", json=payload)
    return response, payload


def test_initial_model_is_seeded_and_versioned(client):
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.json()["active_model"] == "v1"

    current = client.get("/api/model/current")
    assert current.status_code == 200
    model = current.json()
    assert model["version"] == "v1"
    assert model["is_active"] is True
    assert model["test_size"] > 0
    assert 0.0 <= model["accuracy"] <= 1.0
    assert 0.0 <= model["macro_f1"] <= 1.0


def test_feedback_persists_required_fields_without_auto_retraining(client):
    versions_before = client.get("/api/model/versions").json()
    response, payload = post_feedback(client, feedback_type="incorrect", corrected="personal")

    assert response.status_code == 201
    saved = response.json()
    assert saved["email_id"] == payload["email_id"]
    assert saved["predicted_category"] == "important"
    assert saved["corrected_category"] == "personal"
    assert saved["original_confidence"] == payload["original_confidence"]
    assert saved["model_version"] == "v1"
    assert saved["feedback_type"] == "incorrect"
    assert saved["approved_for_training"] is False
    assert saved["created_at"]

    versions_after = client.get("/api/model/versions").json()
    assert len(versions_after) == len(versions_before), "feedback must not trigger retraining"
    assert client.get("/api/model/current").json()["version"] == "v1"


def test_feedback_validation_rejects_incoherent_corrections(client):
    missing_correction = client.post(
        "/api/feedback",
        json=feedback_payload(feedback_type="incorrect"),
    )
    assert missing_correction.status_code == 422

    same_category = client.post(
        "/api/feedback",
        json=feedback_payload(feedback_type="incorrect", corrected="important"),
    )
    assert same_category.status_code == 422

    wrong_correct = client.post(
        "/api/feedback",
        json=feedback_payload(feedback_type="correct", corrected="spam"),
    )
    assert wrong_correct.status_code == 422

    bad_category = client.post(
        "/api/feedback",
        json=feedback_payload(predicted="not-a-bucket"),
    )
    assert bad_category.status_code == 422


def test_correct_feedback_without_explicit_category_is_stored_as_prediction(client):
    response = client.post(
        "/api/feedback",
        json=feedback_payload(feedback_type="correct"),
    )
    assert response.status_code == 201
    assert response.json()["corrected_category"] == "important"


def test_analytics_reports_user_agreement_not_model_accuracy(client):
    post_feedback(client, email_id="a", feedback_type="incorrect", corrected="personal")
    post_feedback(client, email_id="b", feedback_type="incorrect", corrected="personal")
    post_feedback(client, email_id="c", feedback_type="incorrect", corrected="spam")
    post_feedback(client, email_id="d", feedback_type="correct")

    response = client.get("/api/analytics")
    assert response.status_code == 200
    data = response.json()

    assert data["total_feedback"] == 4
    assert data["corrected_predictions"] == 3
    assert data["correct_feedback"] == 1
    assert data["user_agreement_rate"] == 0.25
    assert "not model accuracy" in data["agreement_definition"]
    assert data["most_frequently_corrected_categories"][0] == {
        "category": "personal",
        "count": 2,
    }
    assert data["most_frequently_corrected_categories"][1] == {
        "category": "spam",
        "count": 1,
    }
    assert data["model_accuracy"] == data["current_model"]["accuracy"]
    assert data["model_macro_f1"] == data["current_model"]["macro_f1"]
    assert data["approved_for_training"] == 0


def test_api_responses_are_never_cached(client):
    for path in ("/api/health", "/api/analytics"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"

    private_response = client.get("/api/feedback", headers={"X-Admin-Token": ADMIN_TOKEN})
    assert private_response.status_code == 200
    assert private_response.headers["cache-control"] == "no-store"


def test_cors_allows_only_configured_origins(client):
    allowed = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"

    denied = client.options(
        "/api/health",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in denied.headers


def test_feedback_list_requires_admin(client):
    post_feedback(client, email_id="private-record")
    unauthorized = client.get("/api/feedback")
    assert unauthorized.status_code == 401

    authorized = client.get("/api/feedback", headers={"X-Admin-Token": ADMIN_TOKEN})
    assert authorized.status_code == 200
    assert authorized.json()[0]["email_id"] == "private-record"


def test_csv_export_neutralizes_formula_cells(client):
    response = client.post(
        "/api/feedback",
        json={
            **feedback_payload(email_id="=HYPERLINK(\"https://bad.example\")"),
            "email_subject": " =HYPERLINK(\"https://bad.example\")",
        },
    )
    assert response.status_code == 201
    exported = client.get(
        "/api/feedback/export",
        params={"approved_only": "false"},
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    assert exported.status_code == 200
    rows = list(csv.reader(io.StringIO(exported.text)))
    assert rows[1][1].startswith("'")
    assert rows[1][2].startswith("'")


def test_empty_analytics_does_not_divide_by_zero(client):
    data = client.get("/api/analytics").json()
    assert data["total_feedback"] == 0
    assert data["user_agreement_rate"] == 0.0
    assert data["most_frequently_corrected_categories"] == []


def test_approval_requires_admin_and_marks_training_data(client):
    saved = post_feedback(client, feedback_type="incorrect", corrected="academic")[0].json()

    unauthorized = client.post(f"/api/feedback/{saved['id']}/approve")
    assert unauthorized.status_code == 401

    approved = client.post(
        f"/api/feedback/{saved['id']}/approve",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    assert approved.status_code == 200
    assert approved.json()["approved_for_training"] is True
    assert approved.json()["reviewed_at"]
    assert client.get("/api/analytics").json()["approved_for_training"] == 1


def test_csv_export_defaults_to_approved_feedback(client):
    approved_row = post_feedback(
        client, email_id="approved-email", feedback_type="incorrect", corrected="spam"
    )[0].json()
    post_feedback(client, email_id="unapproved-email", feedback_type="correct")
    client.post(
        f"/api/feedback/{approved_row['id']}/approve",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )

    unauthorized_csv = client.get("/api/feedback/export")
    assert unauthorized_csv.status_code == 401

    admin_headers = {"X-Admin-Token": ADMIN_TOKEN}
    approved_csv = client.get("/api/feedback/export", headers=admin_headers)
    assert approved_csv.status_code == 200
    assert approved_csv.headers["content-type"].startswith("text/csv")
    assert "attachment;" in approved_csv.headers["content-disposition"]
    text = approved_csv.text
    assert "id,email_id,email_subject,predicted_category,corrected_category" in text
    assert "approved-email" in text
    assert "unapproved-email" not in text

    all_csv = client.get(
        "/api/feedback/export",
        params={"approved_only": "false"},
        headers=admin_headers,
    )
    assert "approved-email" in all_csv.text
    assert "unapproved-email" in all_csv.text


def test_retraining_is_admin_only_and_uses_only_approved_feedback(client):
    approved_row = post_feedback(
        client, email_id="approved-1", feedback_type="incorrect", corrected="personal"
    )[0].json()
    post_feedback(client, email_id="unapproved-1", feedback_type="incorrect", corrected="spam")
    client.post(
        f"/api/feedback/{approved_row['id']}/approve",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )

    unauthorized = client.post("/api/model/retrain")
    assert unauthorized.status_code == 401

    response = client.post(
        "/api/model/retrain",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    assert response.status_code == 200
    data = response.json()

    assert data["candidate"]["version"] == "v2"
    assert data["candidate"]["is_active"] is False
    assert data["feedback_used"] == 1
    assert data["evaluation"]["test_size"] > 0
    assert 0.0 <= data["evaluation"]["accuracy"] <= 1.0
    assert "holdout" in data["evaluation"]["dataset"]

    versions = client.get("/api/model/versions").json()
    assert [row["version"] for row in versions] == ["v2", "v1"]
    assert client.get("/api/model/current").json()["version"] == "v1"
    assert versions[1]["is_active"] is True


def test_model_activation_preserves_version_history(client):
    post_feedback(client, email_id="retrain-1", feedback_type="incorrect", corrected="academic")
    feedback_id = client.get(
        "/api/feedback", headers={"X-Admin-Token": ADMIN_TOKEN}
    ).json()[0]["id"]
    client.post(
        f"/api/feedback/{feedback_id}/approve",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    candidate = client.post(
        "/api/model/retrain",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    ).json()["candidate"]

    activate = client.post(
        f"/api/model/{candidate['version']}/activate",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    assert activate.status_code == 200
    assert activate.json()["is_active"] is True
    assert client.get("/api/model/current").json()["version"] == "v2"

    versions = client.get("/api/model/versions").json()
    assert len(versions) == 2
    assert sum(1 for row in versions if row["is_active"]) == 1
