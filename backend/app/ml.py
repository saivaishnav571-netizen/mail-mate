"""Scikit-learn pipelines and honest evaluation.

The browser classifier is a hand-written TF-IDF + logistic-regression model.
This service mirrors it with the equivalent scikit-learn pipeline so feedback
can be used for retraining without changing the demo's existing behaviour.

Every metric reported by this module is computed on the fixed labelled holdout
split returned by :func:`split_seed_samples`. Training accuracy is never used
as test accuracy.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

CATEGORIES = ("important", "academic", "internship", "personal", "spam")
HOLDOUT_EVERY = 5  # one in five examples per class becomes the fixed test set

MODEL_NAME = "MailMate triage classifier"
DEFAULT_ALGORITHM = "logistic_regression"

TFIDF_CONFIG = {
    "analyzer": "word",
    "ngram_range": [1, 2],
    "sublinear_tf": True,
    "strip_accents": "unicode",
    "lowercase": True,
    "min_df": 1,
    "max_df": 1.0,
    "max_features": None,
}

ALGORITHMS = (
    {
        "id": "multinomial_nb",
        "name": "Multinomial Naive Bayes",
        "detail": "Fast probabilistic baseline for word counts.",
    },
    {
        "id": "logistic_regression",
        "name": "Logistic Regression",
        "detail": "The algorithm used by the active feedback model.",
    },
    {
        "id": "linear_svm",
        "name": "Linear SVM",
        "detail": "Maximum-margin linear classifier.",
    },
)

DATASET_LABEL = "fixed labelled holdout from src/lib/ai-training.js"


def load_seed_samples(path: Path) -> list[dict[str, str]]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    samples = []
    for row in rows:
        category = str(row.get("category", "")).strip()
        text = str(row.get("text", "")).strip()
        if category not in CATEGORIES or not text:
            raise ValueError(f"Invalid seed sample: {row!r}")
        samples.append({"category": category, "text": text})
    if not samples:
        raise ValueError("The seed dataset is empty.")
    return samples


def split_seed_samples(
    samples: Iterable[dict[str, str]],
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Return a deterministic, stratified train/test split.

    The test split is fixed for every model version, so metrics are comparable
    across retrains. It is derived only from the existing labelled examples.
    """
    train: list[dict[str, str]] = []
    test: list[dict[str, str]] = []
    seen: defaultdict[str, int] = defaultdict(int)

    for sample in samples:
        category = sample["category"]
        position = seen[category]
        seen[category] += 1
        target = test if position % HOLDOUT_EVERY == 0 else train
        target.append(sample)

    missing = [category for category in CATEGORIES if not any(s["category"] == category for s in test)]
    if missing:
        raise ValueError(f"The evaluation split is missing categories: {missing}")
    return train, test


def _classifier(algorithm: str = DEFAULT_ALGORITHM):
    if algorithm == "logistic_regression":
        return LogisticRegression(max_iter=2_000, C=4.0, random_state=42)
    if algorithm == "multinomial_nb":
        return MultinomialNB(alpha=0.6)
    if algorithm == "linear_svm":
        return LinearSVC(max_iter=5_000, C=1.0, random_state=42)
    raise ValueError(f"Unknown algorithm: {algorithm}")


def build_pipeline(algorithm: str = DEFAULT_ALGORITHM) -> Pipeline:
    return Pipeline(
        steps=[
            ("tfidf", TfidfVectorizer(**{**TFIDF_CONFIG, "ngram_range": tuple(TFIDF_CONFIG["ngram_range"])})),
            ("clf", _classifier(algorithm)),
        ]
    )


def train_pipeline(
    seed_train: list[dict[str, str]],
    approved_feedback: list[dict[str, str]] | None = None,
    algorithm: str = DEFAULT_ALGORITHM,
) -> tuple[Pipeline, int]:
    samples = list(seed_train) + list(approved_feedback or [])
    if not samples:
        raise ValueError("No labelled samples are available for training.")
    pipeline = build_pipeline(algorithm)
    pipeline.fit(
        [sample["text"] for sample in samples],
        [sample["category"] for sample in samples],
    )
    return pipeline, len(samples)


def evaluate_pipeline(
    pipeline: Pipeline,
    test_samples: list[dict[str, str]],
    dataset_label: str,
) -> dict:
    """Evaluate on a labelled test set and return real, reproducible metrics.

    The timed pass happens after one warm-up prediction, so the reported
    latency measures steady-state batch inference rather than import costs.
    """
    if not test_samples:
        raise ValueError("The evaluation set is empty.")

    texts = [sample["text"] for sample in test_samples]
    expected = [sample["category"] for sample in test_samples]

    pipeline.predict([texts[0]])  # warm-up
    started = time.perf_counter()
    predicted = pipeline.predict(texts)
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    correct = int(sum(1 for left, right in zip(expected, predicted) if left == right))
    report = classification_report(
        expected,
        predicted,
        labels=list(CATEGORIES),
        output_dict=True,
        zero_division=0,
    )
    per_category = [
        {
            "category": category,
            "precision": round(float(report[category]["precision"]), 6),
            "recall": round(float(report[category]["recall"]), 6),
            "f1": round(float(report[category]["f1-score"]), 6),
            "support": int(report[category]["support"]),
        }
        for category in CATEGORIES
    ]
    matrix = confusion_matrix(expected, predicted, labels=list(CATEGORIES)).astype(int).tolist()

    return {
        "accuracy": round(float(accuracy_score(expected, predicted)), 6),
        "precision_macro": round(
            float(precision_score(expected, predicted, average="macro", zero_division=0)), 6
        ),
        "recall_macro": round(
            float(recall_score(expected, predicted, average="macro", zero_division=0)), 6
        ),
        "macro_f1": round(float(f1_score(expected, predicted, average="macro", zero_division=0)), 6),
        "correct": correct,
        "test_size": len(test_samples),
        "dataset": dataset_label,
        "per_category": per_category,
        "confusion_matrix": {"labels": list(CATEGORIES), "matrix": matrix},
        "prediction_count": len(test_samples),
        "latency_ms": round(elapsed_ms / len(test_samples), 6),
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
    }


def compare_models(
    train_samples: list[dict[str, str]],
    test_samples: list[dict[str, str]],
    dataset_label: str = DATASET_LABEL,
) -> dict:
    """Train and compare the three candidate algorithms on the same split.

    These are real fits and real held-out evaluations. Comparison models are
    never activated automatically.
    """
    results = []
    for algorithm in ALGORITHMS:
        started = time.perf_counter()
        pipeline, _ = train_pipeline(train_samples, algorithm=algorithm["id"])
        train_ms = (time.perf_counter() - started) * 1000.0
        evaluation = evaluate_pipeline(pipeline, test_samples, dataset_label)
        results.append(
            {
                "id": algorithm["id"],
                "name": algorithm["name"],
                "detail": algorithm["detail"],
                "accuracy": evaluation["accuracy"],
                "precision_macro": evaluation["precision_macro"],
                "recall_macro": evaluation["recall_macro"],
                "macro_f1": evaluation["macro_f1"],
                "train_ms": round(train_ms, 3),
            }
        )

    best = max(results, key=lambda row: (row["macro_f1"], row["accuracy"]))
    return {
        "metric": "macro_f1",
        "best_model": best["id"],
        "models": results,
        "note": (
            "Each algorithm is trained on the same split and scored on the same fixed "
            "labelled holdout. The best macro F1 is highlighted; nothing is activated automatically."
        ),
    }
