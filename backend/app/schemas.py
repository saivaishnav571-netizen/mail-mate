"""Request and response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Category = Literal["important", "academic", "internship", "personal", "spam"]
FeedbackType = Literal["correct", "incorrect"]

AGREEMENT_DEFINITION = (
    "User agreement rate = correct feedback / total feedback. "
    "It is a human review signal, not model accuracy."
)


class FeedbackCreate(BaseModel):
    email_id: str = Field(min_length=1, max_length=160)
    email_subject: str | None = Field(default=None, max_length=400)
    email_text: str | None = Field(default=None, max_length=20_000)
    predicted_category: Category
    corrected_category: Category | None = None
    original_confidence: float = Field(ge=0.0, le=1.0)
    model_version: str | None = Field(default=None, max_length=40)
    feedback_type: FeedbackType

    @model_validator(mode="after")
    def validate_correction(self) -> "FeedbackCreate":
        if self.feedback_type == "correct":
            if self.corrected_category is None:
                self.corrected_category = self.predicted_category
            elif self.corrected_category != self.predicted_category:
                raise ValueError("A correct-prediction feedback must keep the predicted category.")
        else:
            if self.corrected_category is None:
                raise ValueError("An incorrect-prediction feedback needs a corrected category.")
            if self.corrected_category == self.predicted_category:
                raise ValueError("The corrected category must differ from the prediction.")
        return self


class FeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email_id: str
    email_subject: str | None
    predicted_category: str
    corrected_category: str
    original_confidence: float
    model_version: str
    feedback_type: str
    approved_for_training: bool
    created_at: datetime
    reviewed_at: datetime | None


class CategoryCount(BaseModel):
    category: str
    count: int


class ModelVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: str
    created_at: datetime
    training_size: int
    feedback_count: int
    accuracy: float
    macro_f1: float
    test_size: int
    is_active: bool
    notes: str | None


class AnalyticsOut(BaseModel):
    total_feedback: int
    corrected_predictions: int
    correct_feedback: int
    user_agreement_rate: float
    agreement_definition: str = AGREEMENT_DEFINITION
    approved_for_training: int
    most_frequently_corrected_categories: list[CategoryCount]
    current_model: ModelVersionOut | None
    model_accuracy: float | None
    model_macro_f1: float | None


class EvaluationOut(BaseModel):
    accuracy: float
    macro_f1: float
    correct: int
    test_size: int
    dataset: str


class RetrainResponse(BaseModel):
    candidate: ModelVersionOut
    active_before: ModelVersionOut | None
    feedback_used: int
    training_samples: int
    evaluation: EvaluationOut
    recommended: bool


class StatusOut(BaseModel):
    status: str
    active_model: str | None
    feedback_count: int
    approval_required: bool = True


# ---------------------------------------------------------------------------
# Intelligence centre
# ---------------------------------------------------------------------------


class PerCategoryMetric(BaseModel):
    category: Category
    precision: float
    recall: float
    f1: float
    support: int


class ConfusionMatrixOut(BaseModel):
    labels: list[Category]
    matrix: list[list[int]]


class ModelMetricsOut(BaseModel):
    accuracy: float
    precision_macro: float
    recall_macro: float
    macro_f1: float
    correct: int
    test_size: int
    dataset: str
    per_category: list[PerCategoryMetric]
    confusion_matrix: ConfusionMatrixOut
    prediction_count: int
    latency_ms: float
    evaluated_at: datetime


class EvaluationSampleIn(BaseModel):
    sample_id: str | None = Field(default=None, max_length=160)
    subject: str | None = Field(default=None, max_length=400)
    text: str = Field(min_length=1, max_length=20_000)
    category: Category


class ExternalEvaluationIn(BaseModel):
    dataset: str = Field(default="Uploaded labeled dataset", min_length=1, max_length=160)
    confidence_threshold: float = Field(default=0.65, ge=0.0, le=1.0)
    samples: list[EvaluationSampleIn] = Field(min_length=5, max_length=2_000)


class ExternalEvaluationItemOut(BaseModel):
    sample_id: str | None
    subject: str | None
    actual_category: Category
    predicted_category: Category
    confidence: float
    correct: bool
    accepted: bool
    low_confidence: bool
    misclassified: bool
    needs_review: bool
    review_reason: str | None
    probabilities: dict[str, float]


class ExternalEvaluationOut(BaseModel):
    model_version: str
    accuracy: float
    precision_macro: float
    recall_macro: float
    macro_f1: float
    correct: int
    test_size: int
    dataset: str
    per_category: list[PerCategoryMetric]
    confusion_matrix: ConfusionMatrixOut
    confidence_threshold: float
    accepted_count: int
    review_count: int
    coverage: float
    accepted_accuracy: float | None
    low_confidence_count: int
    misclassified_count: int
    brier_score: float
    expected_calibration_error: float
    evaluated_at: datetime
    items: list[ExternalEvaluationItemOut]
    review_items: list[ExternalEvaluationItemOut]
    confidence_note: str


class ModelInfoOut(BaseModel):
    name: str
    version: str
    algorithm: str
    algorithm_id: str
    is_active: bool
    created_at: datetime
    training_samples: int
    test_samples: int
    feedback_samples: int
    tfidf: dict
    notes: str | None = None
    reconstructed: bool = False


class ComparisonModelOut(BaseModel):
    id: str
    name: str
    detail: str
    accuracy: float
    precision_macro: float
    recall_macro: float
    macro_f1: float
    train_ms: float


class ModelComparisonOut(BaseModel):
    metric: str
    best_model: str
    models: list[ComparisonModelOut]
    note: str


class EmailAnalysisIn(BaseModel):
    email_id: str = Field(min_length=1, max_length=160)
    category: Category
    confidence: float = Field(ge=0.0, le=1.0)
    model_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    priority: int = Field(default=0, ge=0, le=100)
    received_at: datetime | None = None


class EmailAnalysisBatchIn(BaseModel):
    dataset: str = Field(default="Test inbox", min_length=1, max_length=160)
    messages: list[EmailAnalysisIn] = Field(min_length=1, max_length=500)


class EmailAnalysisBatchOut(BaseModel):
    received: int
    stored: int
    duplicates: int
    total_analyzed: int


class CountBucket(BaseModel):
    label: str
    count: int


class TimelinePoint(BaseModel):
    date: str
    count: int


class EmailAnalyticsOut(BaseModel):
    total_analyzed: int
    unique_messages: int
    category_distribution: list[CategoryCount]
    priority_distribution: list[CountBucket]
    confidence_distribution: list[CountBucket]
    timeline: list[TimelinePoint]
    last_analyzed_at: datetime | None
    datasets: list[str]


class InferenceOut(BaseModel):
    average_latency_ms: float
    total_predictions: int
    model_loaded: bool
    artifact_exists: bool
    model_load_ms: float | None
    status: Literal["loaded", "artifact_missing", "load_failed"]


class IntelligenceOut(BaseModel):
    generated_at: datetime
    model: ModelInfoOut
    metrics: ModelMetricsOut
    comparison: ModelComparisonOut
    email_analytics: EmailAnalyticsOut
    feedback: AnalyticsOut
    inference: InferenceOut
    disclosures: list[str]


class PredictIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


class PredictOut(BaseModel):
    model_version: str
    predicted_category: Category
    confidence: float
    probabilities: dict[str, float]
    latency_ms: float
