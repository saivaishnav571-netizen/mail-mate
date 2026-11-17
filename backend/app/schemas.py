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
