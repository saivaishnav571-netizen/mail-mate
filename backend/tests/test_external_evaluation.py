"""Tests for evaluation on externally labeled examples."""

from __future__ import annotations


def test_external_labeled_evaluation_returns_metrics_and_review_queue(client, admin_headers):
    payload = {
        "dataset": "hand-labeled smoke test",
        "confidence_threshold": 1.0,
        "samples": [
            {"sample_id": "1", "subject": "Assignment due", "text": "Submit your assignment before Friday through the university portal.", "category": "academic"},
            {"sample_id": "2", "subject": "Interview invitation", "text": "The recruiter invites you to interview for the internship role.", "category": "internship"},
            {"sample_id": "3", "subject": "Family dinner", "text": "Can you join the family for dinner this weekend?", "category": "personal"},
            {"sample_id": "4", "subject": "Contract signature", "text": "Please review the contract and sign it before the deadline.", "category": "important"},
            {"sample_id": "5", "subject": "Prize offer", "text": "You have won a prize. Claim your gift card now.", "category": "spam"},
        ],
    }

    response = client.post("/api/model/evaluate", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["dataset"] == payload["dataset"]
    assert data["test_size"] == 5
    assert 0 <= data["accuracy"] <= 1
    assert 0 <= data["precision_macro"] <= 1
    assert 0 <= data["recall_macro"] <= 1
    assert 0 <= data["macro_f1"] <= 1
    assert data["confusion_matrix"]["labels"] == [
        "important", "academic", "internship", "personal", "spam"
    ]
    assert sum(sum(row) for row in data["confusion_matrix"]["matrix"]) == 5
    assert len(data["items"]) == 5
    assert data["review_count"] == len(data["review_items"])
    assert data["low_confidence_count"] == sum(item["confidence"] < 1.0 for item in data["items"])
    assert data["misclassified_count"] == sum(not item["correct"] for item in data["items"])
    assert data["accepted_count"] == sum(item["confidence"] >= 1.0 for item in data["items"]))
    assert data["review_count"] >= data["low_confidence_count"]
    assert data["review_count"] >= data["misclassified_count"]
    assert data["coverage"] == data["accepted_count"] / 5
    assert 0 <= data["brier_score"] <= 2
    assert 0 <= data["expected_calibration_error"] <= 1
    if data["accepted_count"]:
        assert 0 <= data["accepted_accuracy"] <= 1
    else:
        assert data["accepted_accuracy"] is None
    assert all(item["needs_review"] and item["review_reason"] for item in data["review_items"])
    # Uploaded evaluation samples are not stored as feedback or training data.
    feedback = client.get("/api/feedback?limit=10", headers=admin_headers)
    assert feedback.status_code == 200
    assert feedback.json() == []


def test_external_evaluation_requires_at_least_five_samples(client):
    response = client.post(
        "/api/model/evaluate",
        json={
            "dataset": "too-small",
            "samples": [{"text": "test email", "category": "important"}] * 4,
        },
    )
    assert response.status_code == 422


def test_external_evaluation_rejects_invalid_labels(client):
    response = client.post(
        "/api/model/evaluate",
        json={
            "dataset": "invalid labels",
            "samples": [{"text": "text", "category": "unknown"}] * 5,
        },
    )
    assert response.status_code == 422
