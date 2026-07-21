"""Wire contract for synthetic dataset generation and query review.

Split from `app/schemas/evals.py` (which keeps datasets, runs, metrics, and
attribution) purely by module size; the two files are one domain. Mirrored in
`frontend/src/lib/types/evals.ts` — a change here changes the mirror in the
same PR.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.enums import EvalQuestionType

DEFAULT_QUESTION_TYPE_MIX: dict[EvalQuestionType, float] = {
    EvalQuestionType.SINGLE_FACT: 0.5,
    EvalQuestionType.PARAPHRASED: 0.25,
    EvalQuestionType.MULTI_DETAIL: 0.25,
}


class EvalDatasetGenerateRequest(BaseModel):
    """Request to generate a synthetic dataset from one of the user's collections.

    Everything beyond the collection, model, and question count is optional:
    `audience` and `example_queries` steer question style toward real usage
    (never required), and `type_mix` weights are normalized before sampling.
    """

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    collection_id: UUID
    connection_id: UUID
    model_name: str = Field(min_length=1)
    num_questions: int = Field(default=50, ge=1, le=500)
    type_mix: dict[EvalQuestionType, float] = Field(
        default_factory=lambda: dict(DEFAULT_QUESTION_TYPE_MIX)
    )
    audience: str | None = Field(default=None, max_length=2000)
    example_queries: list[str] = Field(default_factory=list, max_length=3)
    seed: int = 0

    @field_validator("type_mix")
    @classmethod
    def _usable_mix(
        cls, value: dict[EvalQuestionType, float]
    ) -> dict[EvalQuestionType, float]:
        """Reject negative weights and all-zero mixes; weights are ratios, not sums."""
        if any(weight < 0 for weight in value.values()):
            raise ValueError("Question type weights must be non-negative.")
        if not any(weight > 0 for weight in value.values()):
            raise ValueError("At least one question type weight must be positive.")
        return value

    @field_validator("example_queries")
    @classmethod
    def _trimmed_examples(cls, value: list[str]) -> list[str]:
        """Drop blank entries and cap each example's length."""
        cleaned = [entry.strip() for entry in value if entry.strip()]
        if any(len(entry) > 500 for entry in cleaned):
            raise ValueError("Example queries must be 500 characters or fewer.")
        return cleaned


class EvalDatasetQueryGold(BaseModel):
    """One gold document reference on a dataset query, with its display title."""

    external_doc_id: str
    title: str | None = None


class EvalDatasetQueryRead(BaseModel):
    """One dataset query with its generation metadata, for the review table.

    The metadata fields are populated for synthetic queries only; benchmark
    and uploaded queries carry just the text and gold references.
    """

    id: UUID
    external_query_id: str
    text: str
    question_type: EvalQuestionType | None = None
    scores: dict[str, int] | None = None
    quote: str | None = None
    gold: list[EvalDatasetQueryGold] = Field(default_factory=list)


class EvalDatasetQueriesPage(BaseModel):
    """One page of a dataset's queries plus the total count for the pager."""

    total: int
    items: list[EvalDatasetQueryRead] = Field(default_factory=list)


class EvalDatasetQueryUpdate(BaseModel):
    """Edit one dataset query's text (gold labels are unchanged)."""

    text: str = Field(min_length=1, max_length=2000)
