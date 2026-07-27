"""Protocols and models for document parsing."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field

from ..models import Document, DocumentMetadata


class DocumentSource(BaseModel):
    """Represents a raw document asset ready for parsing."""

    document_id: str
    path: Path
    content_type: str | None = None
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)


class DocumentParser(Protocol):
    """Protocol describing how to turn a raw document into indexable text."""

    def parse(self, source: DocumentSource) -> Document:
        """Parse a document source into a normalized document."""
        ...


def build_document_from_source(source: DocumentSource, text: str) -> Document:
    """Build a Document from a source and parsed text."""
    metadata = source.metadata.model_copy(deep=True)
    return Document(
        document_id=source.document_id,
        text=text,
        metadata=metadata,
    )
