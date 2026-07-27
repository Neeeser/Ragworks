"""Protocols for reranker implementations."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from ..models import ScoredChunk


class Reranker(Protocol):
    """Protocol describing reranking behaviour."""

    def rerank(
        self,
        query: str,
        candidates: Sequence[ScoredChunk],
    ) -> Sequence[ScoredChunk]:
        """Score and reorder every candidate for the query."""
        ...
