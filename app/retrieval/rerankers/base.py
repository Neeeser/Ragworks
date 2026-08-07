"""Protocols for reranker implementations."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from ..models import RerankCandidate, ScoredChunk


class Reranker(Protocol):
    """Protocol describing reranking behaviour.

    A candidate carries the image its chunk stands for, when it has one.
    An implementation whose endpoint scores text only refuses such a
    stream (`text_documents`) rather than ranking the placeholder text an
    image chunk is stored under.
    """

    def rerank(
        self,
        query: str,
        candidates: Sequence[RerankCandidate],
    ) -> Sequence[ScoredChunk]:
        """Score and reorder every candidate for the query."""
        ...
