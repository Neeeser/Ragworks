"""Protocols for embedding text into vectors."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from ..models import DocumentChunk, EmbeddingVector


class Embedder(Protocol):
    """Protocol for embedding text chunks and queries."""

    model_name: str

    @property
    def usage(self) -> dict[str, int] | None:
        """Most recent embedding call's token usage, when the provider reports it."""
        ...

    def embed_documents(self, chunks: Sequence[DocumentChunk]) -> Sequence[EmbeddingVector]:
        """Embed a sequence of document chunks."""
        ...

    def embed_query(self, query: str) -> EmbeddingVector:
        """Embed a query string into a vector."""
        ...
