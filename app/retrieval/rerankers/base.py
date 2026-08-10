"""Protocols for reranker implementations."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from app.schemas.usage import MeasuredUsage

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

    @property
    def usage(self) -> MeasuredUsage | None:
        """The most recent call's reported spend, or None when unreported.

        Rerank endpoints denominate differently — Cohere bills search units,
        the Jina/Cohere-shaped endpoints report tokens, TEI reports nothing —
        so each implementation answers in the unit its provider published.
        """
        ...
