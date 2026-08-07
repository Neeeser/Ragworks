"""Shared validation for provider-returned reranking scores."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.retrieval.models import RerankCandidate, ScoredChunk
from app.services.errors import InvalidInputError


@dataclass(frozen=True)
class RerankScore:
    """A provider score qualified by its original candidate index."""

    index: int
    score: float


def text_documents(candidates: Sequence[RerankCandidate], *, provider: str) -> list[str]:
    """Return each candidate's text, refusing a stream this endpoint cannot read.

    A text-only rerank endpoint scores whatever strings it is handed, and
    an image chunk's stored text is a derived placeholder naming the file
    — so ranking those ranks filenames, with no error and a plausible
    ordering. Failing names the mismatch while the user can still act on it.
    """
    if any(candidate.image is not None for candidate in candidates):
        raise InvalidInputError(
            f"{provider} reranking models score text only, and these results include "
            "images. Pick a reranking model that accepts images, or remove the "
            "reranker node from this pipeline."
        )
    return [candidate.match.chunk.text for candidate in candidates]


def apply_rerank_scores(
    candidates: Sequence[RerankCandidate], scores: Sequence[RerankScore]
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
        candidate.match.model_copy(update={"score": score_by_index[index]})
        for index, candidate in enumerate(candidates)
    ]
    ranked.sort(key=lambda candidate: candidate.score, reverse=True)
    return ranked
