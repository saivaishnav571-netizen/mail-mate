"""Unit tests for the scikit-learn evaluation and comparison helpers."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from backend.app.ml import (
    CATEGORIES,
    TFIDF_CONFIG,
    build_pipeline,
    compare_models,
    evaluate_pipeline,
    load_seed_samples,
    split_seed_samples,
    train_pipeline,
)

SEED_PATH = Path(__file__).resolve().parents[1] / "app" / "seed_data.json"


def seed_samples():
    return load_seed_samples(SEED_PATH)


def test_seed_file_has_balanced_labelled_examples():
    samples = seed_samples()
    assert len(samples) == 125
    counts = Counter(sample["category"] for sample in samples)
    assert counts == {category: 25 for category in CATEGORIES}


def test_split_is_a_deterministic_stratified_holdout():
    train, test = split_seed_samples(seed_samples())

    assert len(train) == 100
    assert len(test) == 25
    assert all(sample["category"] in CATEGORIES for sample in train + test)

    train_counts = Counter(sample["category"] for sample in train)
    test_counts = Counter(sample["category"] for sample in test)
    assert train_counts == {category: 20 for category in CATEGORIES}
    assert test_counts == {category: 5 for category in CATEGORIES}

    train_keys = {(sample["category"], sample["text"]) for sample in train}
    test_keys = {(sample["category"], sample["text"]) for sample in test}
    assert train_keys.isdisjoint(test_keys)

    # The split is fixed, so every model version is scored on the same rows.
    again_train, again_test = split_seed_samples(seed_samples())
    assert again_train == train
    assert again_test == test


def test_pipeline_uses_the_documented_tfidf_configuration():
    pipeline = build_pipeline()
    tfidf = pipeline.named_steps["tfidf"]

    assert tfidf.analyzer == TFIDF_CONFIG["analyzer"]
    assert tfidf.ngram_range == tuple(TFIDF_CONFIG["ngram_range"])
    assert tfidf.sublinear_tf is TFIDF_CONFIG["sublinear_tf"]
    assert tfidf.lowercase is TFIDF_CONFIG["lowercase"]
    assert type(pipeline.named_steps["clf"]).__name__ == "LogisticRegression"


def test_unknown_algorithms_are_rejected():
    with pytest.raises(ValueError):
        build_pipeline("random_forest")


def test_evaluate_pipeline_returns_real_holdout_metrics():
    train, test = split_seed_samples(seed_samples())
    pipeline, training_size = train_pipeline(train)
    assert training_size == 100

    metrics = evaluate_pipeline(pipeline, test, "unit-test holdout")

    assert metrics["test_size"] == 25
    assert metrics["prediction_count"] == 25
    assert metrics["dataset"] == "unit-test holdout"
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert 0.0 <= metrics["macro_f1"] <= 1.0
    assert 0.0 <= metrics["latency_ms"]
    assert metrics["correct"] == round(metrics["accuracy"] * metrics["test_size"])

    per_category = metrics["per_category"]
    assert [row["category"] for row in per_category] == list(CATEGORIES)
    assert sum(row["support"] for row in per_category) == 25

    matrix = metrics["confusion_matrix"]
    assert matrix["labels"] == list(CATEGORIES)
    assert len(matrix["matrix"]) == len(CATEGORIES)
    assert [sum(row) for row in matrix["matrix"]] == [5] * len(CATEGORIES)
    assert sum(sum(row) for row in matrix["matrix"]) == 25

    # Metrics are evaluated after fitting, and the evaluation does not mutate
    # the fitted pipeline.
    assert pipeline.predict([test[0]["text"]])[0] in CATEGORIES


def test_evaluate_pipeline_rejects_an_empty_test_set():
    train, _ = split_seed_samples(seed_samples())
    pipeline, _ = train_pipeline(train)
    with pytest.raises(ValueError):
        evaluate_pipeline(pipeline, [], "empty")


def test_compare_models_trains_each_candidate_on_the_same_split():
    train, test = split_seed_samples(seed_samples())
    comparison = compare_models(train, test, "unit-test holdout")

    assert {model["id"] for model in comparison["models"]} == {
        "multinomial_nb",
        "logistic_regression",
        "linear_svm",
    }
    assert comparison["metric"] == "macro_f1"

    for reported in comparison["models"]:
        pipeline, _ = train_pipeline(train, algorithm=reported["id"])
        metrics = evaluate_pipeline(pipeline, test, "unit-test holdout")
        assert reported["macro_f1"] == metrics["macro_f1"]
        assert reported["accuracy"] == metrics["accuracy"]
        assert reported["precision_macro"] == metrics["precision_macro"]
        assert reported["recall_macro"] == metrics["recall_macro"]

    best = max(model["macro_f1"] for model in comparison["models"])
    winner = next(model for model in comparison["models"] if model["id"] == comparison["best_model"])
    assert winner["macro_f1"] == best
