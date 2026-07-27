"""Protocols for document chunking."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from ..models import Document, DocumentChunk


class DocumentChunker(Protocol):
    """Protocol describing chunker implementations."""

    def chunk(self, document: Document) -> Sequence[DocumentChunk]:
        """Chunk the given document into smaller pieces."""
        ...
