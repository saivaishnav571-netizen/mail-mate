"""API tests for the AI Intelligence Center."""

from __future__ import annotations

CATEGORIES = ("important", "academic", "internship", "personal", "spam")


def analysis_message(
    email_id: str = "finance-budget-01",
    *,
    category: str = "important",
    confidence: float = 0.82,
    priority: int = 72,
):
    return {
        "email_id": email_id,
        "category": category,
        "confidence": confidence,
        "model_confidence": min(1.0, confidence + 0.05),
        "priority": priority,
        "received_at": "2026-11-15T08:30:00Z",
    }


def test_intelligence_reports_held_out_metrics(client):
    response = client.get("/api/intelligence")
    assert response.status_code == 200
    data = response.json()

    metrics = data["metrics"]
    assert metrics["test_size"] == 25
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert 0.0 <= metrics["precision_macro"] <= 1.0
    assert 0.0 <= metrics["recall_macro"] <= 1.0
    assert 0.0 <= metrics["macro_f1"] <= 1.0
    assert metrics["correct"] == round(metrics["accuracy"] * metrics["test_size"])

    # The stored version and the report must describe the same evaluation.
    current = client.get("/api/model/current").json()
    assert current["accuracy"] == metrics["accuracy"]
    assert current["macro_f1"] == metrics["macro_f1"]
    assert current["test_size"] == metrics["test_size"]

    # Per-category supports and the confusion matrix cover the whole holdout.
    assert [row["category"] for row in metrics["per_category"]] == list(CATEGORIES)
    assert sum(row["support"] for row in metrics["per_category"]) == metrics["test_size"]

    matrix = metrics["confusion_matrix"]
    assert matrix["labels"] == list(CATEGORIES)
    assert len(matrix["matrix"]) == len(CATEGORIES)
    assert all(len(row) == len(CATEGORIES) for row in matrix["matrix"])
    assert sum(sum(row) for row in matrix["matrix"]) == metrics["test_size"]
    assert "holdout" in metrics["dataset"].lower()


def test_model_information_is_complete(client):
    data = client.get("/api/intelligence").json()
    model = data["model"]

    assert model["name"]
    assert model["version"] == client.get("/api/model/current").json()["version"]
    assert model["algorithm"] == "Logistic Regression"
    assert model["algorithm_id"] == "logistic_regression"
    assert model["is_active"] is True
    assert model["created_at"]
    assert model["training_samples"] == 100
    assert model["test_samples"] == 25

    tfidf = model["tfidf"]
    assert tfidf["analyzer"] == "word"
    assert tfidf["ngram_range"] == [1, 2]
    assert tfidf["sublinear_tf"] is True
    assert tfidf["lowercase"] is True


def test_comparison_uses_three_models_and_highlights_best_macro_f1(client):
    comparison = client.get("/api/intelligence").json()["comparison"]

    assert comparison["metric"] == "macro_f1"
    assert {model["id"] for model in comparison["models"]} == {
        "multinomial_nb",
        "logistic_regression",
        "linear_svm",
    }
    assert {model["name"] for model in comparison["models"]} == {
        "Multinomial Naive Bayes",
        "Logistic Regression",
        "Linear SVM",
    }

    for model in comparison["models"]:
        for key in ("accuracy", "precision_macro", "recall_macro", "macro_f1"):
            assert 0.0 <= model[key] <= 1.0
        assert model["train_ms"] >= 0.0

    best = max(model["macro_f1"] for model in comparison["models"])
    winner = next(model for model in comparison["models"] if model["id"] == comparison["best_model"])
    assert winner["macro_f1"] == best
    assert "same" in comparison["note"].lower()

    # A second read must not change the recorded comparison.
    again = client.get("/api/intelligence").json()["comparison"]
    assert again["best_model"] == comparison["best_model"]
    assert [model["macro_f1"] for model in again["models"]] == [
        model["macro_f1"] for model in comparison["models"]
    ]


def test_email_analysis_batch_is_deduplicated(client):
    payload = {
        "dataset": "Test inbox",
        "messages": [
            analysis_message("finance-budget-01", category="important", confidence=0.82, priority=82),
            analysis_message("internship-recruiter-19", category="internship", confidence=0.64, priority=48),
            # Same message and prediction twice in one request.
            analysis_message("finance-budget-01", category="important", confidence=0.82, priority=82),
        ],
    }

    first = client.post("/api/emails/analyze", json=payload)
    assert first.status_code == 201
    result = first.json()
    assert result == {"received": 3, "stored": 2, "duplicates": 1, "total_analyzed": 2}

    # Replaying the same batch stores nothing new.
    second = client.post("/api/emails/analyze", json=payload)
    assert second.status_code == 201
    assert second.json() == {"received": 3, "stored": 0, "duplicates": 3, "total_analyzed": 2}

    analytics = client.get("/api/intelligence").json()["email_analytics"]
    assert analytics["total_analyzed"] == 2
    assert analytics["unique_messages"] == 2
    assert analytics["datasets"] == ["Test inbox"]

    distribution = {row["category"]: row["count"] for row in analytics["category_distribution"]}
    assert distribution["important"] == 1
    assert distribution["internship"] == 1
    assert sum(distribution.values()) == 2

    priority = {row["label"]: row["count"] for row in analytics["priority_distribution"]}
    assert priority["25–49"] == 1
    assert priority["75–100"] == 1

    confidence = {row["label"]: row["count"] for row in analytics["confidence_distribution"]}
    assert sum(confidence.values()) == 2

    assert len(analytics["timeline"]) == 1
    assert analytics["timeline"][0]["count"] == 2
    assert analytics["last_analyzed_at"]


def test_email_analysis_rejects_invalid_metadata(client):
    bad_category = client.post(
        "/api/emails/analyze",
        json={"dataset": "Test inbox", "messages": [analysis_message(category="urgent")]},
    )
    assert bad_category.status_code == 422

    bad_confidence = client.post(
        "/api/emails/analyze",
        json={"dataset": "Test inbox", "messages": [analysis_message(confidence=1.4)]},
    )
    assert bad_confidence.status_code == 422

    empty = client.post("/api/emails/analyze", json={"dataset": "Test inbox", "messages": []})
    assert empty.status_code == 422


def test_email_analytics_is_empty_before_any_ingest(client):
    analytics = client.get("/api/intelligence").json()["email_analytics"]
    assert analytics["total_analyzed"] == 0
    assert analytics["unique_messages"] == 0
    assert analytics["timeline"] == []
    assert analytics["datasets"] == []
    assert analytics["last_analyzed_at"] is None


def test_prediction_endpoint_returns_real_probabilities_and_counts_inference(client):
    before = client.get("/api/intelligence").json()["inference"]
    response = client.post(
        "/api/model/predict",
        json={"text": "We would like to invite you to an interview for the software internship."},
    )
    assert response.status_code == 200
    prediction = response.json()

    assert prediction["model_version"] == client.get("/api/model/current").json()["version"]
    assert prediction["predicted_category"] in CATEGORIES
    assert 0.0 <= prediction["confidence"] <= 1.0
    assert set(prediction["probabilities"]) == set(CATEGORIES)
    assert abs(sum(prediction["probabilities"].values()) - 1.0) < 1e-3
    assert prediction["latency_ms"] >= 0.0

    after = client.get("/api/intelligence").json()["inference"]
    assert after["total_predictions"] == before["total_predictions"] + 1
    assert after["average_latency_ms"] >= 0.0
    assert after["model_loaded"] is True
    assert after["artifact_exists"] is True
    assert after["status"] == "loaded"
    assert after["model_load_ms"] is not None

    assert client.post("/api/model/predict", json={"text": ""}).status_code == 422


def test_intelligence_does_not_retrain_or_activate_automatically(client):
    before = client.get("/api/model/versions").json()
    assert len(before) == 1

    assert client.get("/api/intelligence").status_code == 200
    assert client.get("/api/intelligence").status_code == 200
    assert client.post(
        "/api/emails/analyze",
        json={"dataset": "Test inbox", "messages": [analysis_message()]},
    ).status_code == 201
    assert client.post("/api/model/predict", json={"text": "Budget review due Friday."}).status_code == 200

    after = client.get("/api/model/versions").json()
    assert len(after) == len(before)
    assert after[0]["version"] == before[0]["version"]
    active = [row for row in after if row["is_active"]]
    assert len(active) == 1


def test_feedback_agreement_is_reported_separately_from_model_accuracy(client):
    correct = client.post(
        "/api/feedback",
        json={
            "email_id": "finance-budget-01",
            "predicted_category": "important",
            "original_confidence": 0.82,
            "feedback_type": "correct",
        },
    )
    assert correct.status_code == 201

    incorrect = client.post(
        "/api/feedback",
        json={
            "email_id": "internship-recruiter-19",
            "predicted_category": "important",
            "corrected_category": "internship",
            "original_confidence": 0.61,
            "feedback_type": "incorrect",
        },
    )
    assert incorrect.status_code == 201

    data = client.get("/api/intelligence").json()
    feedback = data["feedback"]
    assert feedback["total_feedback"] == 2
    assert feedback["corrected_predictions"] == 1
    assert feedback["correct_feedback"] == 1
    assert feedback["user_agreement_rate"] == 0.5
    assert feedback["most_frequently_corrected_categories"] == [
        {"category": "internship", "count": 1}
    ]
    assert "not model accuracy" in feedback["agreement_definition"].lower()

    # The model's held-out accuracy is its own, independent number.
    assert data["metrics"]["accuracy"] == feedback["model_accuracy"]
    assert data["metrics"]["accuracy"] != feedback["user_agreement_rate"]


def test_intelligence_disclosures_are_explicit(client):
    disclosures = " ".join(client.get("/api/intelligence").json()["disclosures"]).lower()
    assert "holdout" in disclosures
    assert "not a guarantee" in disclosures
    assert "not model accuracy" in disclosures
    assert "never" in disclosures
