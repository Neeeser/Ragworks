"""Token and cost accounting for the model work an eval job performed.

Split from `app/schemas/evals.py` by module size; the two files are one
domain. Mirrored in `frontend/src/lib/types/evals.ts`.

Every field is optional, and `None` means "not reported" — distinct from `0`,
which is a provider that reported no spend. `cost_usd` is populated only where
the model's provider publishes per-token pricing (`app/providers/pricing.py`);
tokens are always reported.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EvalUsage(BaseModel):
    """One accumulator of provider token accounting, priced where possible."""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None

    def merged_with(self, other: EvalUsage) -> EvalUsage:
        """Return a new accumulator with each field summed, `None`-safe."""
        return EvalUsage(
            prompt_tokens=_add_int(self.prompt_tokens, other.prompt_tokens),
            completion_tokens=_add_int(self.completion_tokens, other.completion_tokens),
            total_tokens=_add_int(self.total_tokens, other.total_tokens),
            cost_usd=_add(self.cost_usd, other.cost_usd),
        )

    def is_empty(self) -> bool:
        """True when nothing was ever reported."""
        return not self.model_dump(exclude_none=True)

    def billable_tokens(self) -> int | None:
        """The token count to price: the total, or the prompt side alone.

        Embedding providers report only `prompt_tokens` on some models and
        only `total_tokens` on others, so a reader that picks one field
        reports zero spend for half the catalog.
        """
        if self.total_tokens is not None:
            return self.total_tokens
        return self.prompt_tokens


class EvalRunUsage(BaseModel):
    """An eval run's spend, split by the phase that incurred it.

    Eval collections are reused across runs, so `ingestion` counts only the
    documents this run actually ingested — a reused collection reports none.
    """

    ingestion: EvalUsage = Field(default_factory=EvalUsage)
    retrieval: EvalUsage = Field(default_factory=EvalUsage)

    def is_empty(self) -> bool:
        """True when neither phase reported anything."""
        return self.ingestion.is_empty() and self.retrieval.is_empty()


def _add(left: float | None, right: float | None) -> float | None:
    """Sum two optional floats, treating `None` as "no data"."""
    if left is None:
        return right
    if right is None:
        return left
    return left + right


def _add_int(left: int | None, right: int | None) -> int | None:
    """Sum two optional token counts, treating `None` as "no data"."""
    if left is None:
        return right
    if right is None:
        return left
    return left + right
