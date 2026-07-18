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
    """Validate provider scores and rank every candidate by relevance."""
    if len(scores) != len(candidates):
        raise ValueError("Reranking provider must return every candidate.")
    seen: set[int] = set()
    score_by_index: dict[int, float] = {}
    for result in scores:
        if result.index in seen:
            raise ValueError("Reranking provider returned a duplicate candidate index.")
        if result.index < 0 or result.index >= len(candidates):
            raise ValueError("Reranking provider returned an out-of-range candidate index.")
        if not math.isfinite(result.score):
            raise ValueError("Reranking provider returned a non-finite relevance score.")
        seen.add(result.index)
        score_by_index[result.index] = result.score
    ranked = [
        candidate.model_copy(update={"score": score_by_index[index]})
        for index, candidate in enumerate(candidates)
    ]
    ranked.sort(key=lambda candidate: candidate.score, reverse=True)
    return ranked
