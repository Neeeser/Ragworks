"""Protocols for embedding text and images into vectors."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from app.schemas.media import InlineMedia

from ..models import DocumentChunk, EmbeddingVector


class Embedder(Protocol):
    """Protocol for embedding text chunks, queries, and images.

    `embed_images` is part of the one protocol rather than a separate
    capability interface: whether a model takes images is answered by its
    provider catalog (`app/pipelines/model_modality_rules.py`), which is what
    decides whether the call is made at all. An implementation whose
    provider serves no image input raises `InvalidInputError` naming
    itself, so a caller that reached it despite the catalog gets a message
    that says which provider refused.
    """

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

    def embed_images(self, images: Sequence[InlineMedia]) -> Sequence[EmbeddingVector]:
        """Embed images into vectors in the model's shared space."""
        ...
