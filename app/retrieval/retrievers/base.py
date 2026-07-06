"""Protocols for retrieval backends."""

from __future__ import annotations

from typing import Protocol, Sequence

from ..models import QueryRequest, RetrievalResponse


class Retriever(Protocol):  # pylint: disable=too-few-public-methods
    """Protocol describing read access to a vector index."""

    def retrieve(self, request: QueryRequest, *, embedding: Sequence[float]) -> RetrievalResponse:
        """Return retrieval results for the query request."""
        return None
