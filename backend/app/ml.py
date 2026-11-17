"""Scikit-learn pipeline and honest evaluation split.

The browser classifier is a hand-written TF-IDF + logistic-regression model.
This service mirrors it with the equivalent scikit-learn pipeline so feedback
can be used for retraining without changing the demo's existing behaviour.
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Iterable

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.pipeline import Pipeline

CATEGORIES = ("important", "academic", "internship", "personal", "spam")
HOLDOUT_EVERY = 5  # one in five examples per class becomes the fixed test set


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


def build_pipeline() -> Pipeline:
    return Pipeline(
        steps=[
            (
                "tfidf",
                TfidfVectorizer(
                    ngram_range=(1, 2),
                    sublinear_tf=True,
                    strip_accents="unicode",
                    lowercase=True,
                ),
            ),
            (
                "clf",
                LogisticRegression(max_iter=2_000, C=4.0, random_state=42),
            ),
        ]
    )


def train_pipeline(
    seed_train: list[dict[str, str]],
    approved_feedback: list[dict[str, str]] | None = None,
) -> tuple[Pipeline, int]:
    samples = list(seed_train) + list(approved_feedback or [])
    if not samples:
        raise ValueError("No labelled samples are available for training.")
    pipeline = build_pipeline()
    pipeline.fit(
        [sample["text"] for sample in samples],
        [sample["category"] for sample in samples],
    )
    return pipeline, len(samples)


def evaluate_pipeline(
    pipeline: Pipeline,
    test_samples: list[dict[str, str]],
    dataset_label: str,
) -> dict[str, float | int | str]:
    texts = [sample["text"] for sample in test_samples]
    expected = [sample["category"] for sample in test_samples]
    predicted = pipeline.predict(texts)
    correct = sum(1 for left, right in zip(expected, predicted) if left == right)
    return {
        "accuracy": float(accuracy_score(expected, predicted)),
        "macro_f1": float(f1_score(expected, predicted, average="macro", zero_division=0)),
        "correct": int(correct),
        "test_size": len(test_samples),
        "dataset": dataset_label,
    }
