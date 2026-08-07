"""Wire contract for synthetic dataset generation and query review.

Split from `app/schemas/evals.py` (which keeps datasets, runs, metrics, and
attribution) purely by module size; the two files are one domain. Mirrored in
`frontend/src/lib/types/evals.ts` — a change here changes the mirror in the
same PR.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.enums import EvalModality, EvalQuestionType
from app.schemas.media import MediaAssetRef

DEFAULT_QUESTION_TYPE_MIX: dict[EvalQuestionType, float] = {
    EvalQuestionType.SINGLE_FACT: 0.5,
    EvalQuestionType.PARAPHRASED: 0.25,
    EvalQuestionType.MULTI_DETAIL: 0.25,
}


class GenerationModelChoice(BaseModel):
    """The connection and model one modality's generation calls are made with."""

    connection_id: UUID
    model_name: str = Field(min_length=1)


class EvalDatasetGenerateRequest(BaseModel):
    """Request to generate a synthetic dataset from one of the user's collections.

    `models` maps each modality the collection holds to the model that reads
    it; a text entry is always required, since every dataset produces text
    questions. Everything beyond the collection, the models, and the question
    count is optional: `audience` and `example_queries` steer question style
    toward real usage (never required), and `type_mix` weights are normalized
    before sampling.
    """

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    collection_id: UUID
    models: dict[EvalModality, GenerationModelChoice]
    num_questions: int = Field(default=50, ge=1, le=500)
    type_mix: dict[EvalQuestionType, float] = Field(
        default_factory=lambda: dict(DEFAULT_QUESTION_TYPE_MIX)
    )
    audience: str | None = Field(default=None, max_length=2000)
    example_queries: list[str] = Field(default_factory=list)
    seed: int = 0

    @model_validator(mode="before")
    @classmethod
    def _lift_flat_model_choice(cls, data: object) -> object:
        """Lift a stored flat `(connection_id, model_name)` pair into `models`.

        A dataset row created before generation took a per-modality map holds
        the flat shape in its `generation_config`, and that config is
        re-validated every time its run resumes; reading it as a text choice
        keeps those rows generating.
        """
        if not isinstance(data, dict):
            return data
        payload: dict[str, object] = {str(key): value for key, value in data.items()}
        connection_id = payload.pop("connection_id", None)
        model_name = payload.pop("model_name", None)
        if payload.get("models") is not None:
            return payload
        if connection_id is None or model_name is None:
            return payload
        payload["models"] = {
            EvalModality.TEXT.value: {
                "connection_id": connection_id,
                "model_name": model_name,
            }
        }
        return payload

    @field_validator("models")
    @classmethod
    def _requires_a_text_model(
        cls, value: dict[EvalModality, GenerationModelChoice]
    ) -> dict[EvalModality, GenerationModelChoice]:
        """Reject a map with no text model: every dataset produces text questions."""
        if EvalModality.TEXT not in value:
            raise ValueError("A model for the text modality is required.")
        return value

    @field_validator("type_mix")
    @classmethod
    def _usable_mix(cls, value: dict[EvalQuestionType, float]) -> dict[EvalQuestionType, float]:
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
    and uploaded queries carry just the text and gold references. `text` is
    optional because an image query asks with a picture and carries none —
    such a query carries `media` instead, and the review table has that to
    name in the row where the text would be.
    """

    id: UUID
    external_query_id: str
    text: str | None = None
    media: MediaAssetRef | None = None
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
