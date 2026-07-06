"""Payload models used between pipeline nodes."""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, Field

from app.retrieval.models import (
    Document,
    DocumentChunk,
    EmbeddingVector,
    QueryRequest,
    RetrievalResponse,
)
from app.retrieval.parsers.base import DocumentSource


class SourcePayload(BaseModel):
    """Payload containing a document source."""

    source: DocumentSource


class ParsedDocumentPayload(BaseModel):
    """Payload containing a parsed document."""

    document: Document


class ChunkPayload(BaseModel):
    """Payload containing chunks for a document."""

    document: Document
    chunks: List[DocumentChunk]


class EmbeddingPayload(BaseModel):
    """Payload containing embedded chunks for a document."""

    document: Document
    chunks: List[DocumentChunk]
    usage: Dict[str, int] = Field(default_factory=dict)


class IndexingPayload(BaseModel):
    """Payload containing indexed chunks for a document."""

    document: Document
    chunks: List[DocumentChunk]
    usage: Dict[str, int] = Field(default_factory=dict)


class RetrievalRequestPayload(BaseModel):
    """Payload containing a retrieval request."""

    request: QueryRequest


class QueryEmbeddingPayload(BaseModel):
    """Payload containing a query embedding."""

    request: QueryRequest
    embedding: EmbeddingVector
    usage: Dict[str, int] = Field(default_factory=dict)


class RetrievalPayload(BaseModel):
    """Payload containing retrieval results."""

    response: RetrievalResponse
    usage: Dict[str, int] = Field(default_factory=dict)
