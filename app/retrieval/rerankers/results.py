"""Shared validation for provider-returned reranking scores."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.retrieval.models import ScoredChunk


@dataclass(frozen=True)
class RerankScore:
    """A provider score qualified by its original candidate index."""

    index: int
    score: float


def apply_rerank_scores(
    candidates: Sequence[ScoredChunk], scores: Sequence[RerankScore]
) -> list[ScoredChunk]:
    """Validate a complete provider ranking and map it back to chunks."""
    if len(scores) != len(candidates):
        raise ValueError("Reranking provider must return every candidate.")
    seen: set[int] = set()
    ranked: list[ScoredChunk] = []
    for result in scores:
        if result.index in seen:
            raise ValueError("Reranking provider returned a duplicate candidate index.")
        if result.index < 0 or result.index >= len(candidates):
            raise ValueError("Reranking provider returned an out-of-range candidate index.")
        if not math.isfinite(result.score):
            raise ValueError("Reranking provider returned a non-finite relevance score.")
        seen.add(result.index)
        ranked.append(
            candidates[result.index].model_copy(update={"score": result.score})
        )
    return ranked
