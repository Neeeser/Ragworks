"""Payload models used between pipeline nodes."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.pipelines.tracing.summaries import TokenUsage
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
    chunks: list[DocumentChunk]


class EmbeddingPayload(BaseModel):
    """Payload containing embedded chunks for a document."""

    document: Document
    chunks: list[DocumentChunk]
    usage: TokenUsage = Field(default_factory=TokenUsage)


class IndexingPayload(BaseModel):
    """Payload containing indexed chunks for a document."""

    document: Document
    chunks: list[DocumentChunk]
    usage: TokenUsage = Field(default_factory=TokenUsage)


class RetrievalRequestPayload(BaseModel):
    """Payload containing a retrieval request."""

    request: QueryRequest


class QueryEmbeddingPayload(BaseModel):
    """Payload containing a query embedding."""

    request: QueryRequest
    embedding: EmbeddingVector
    usage: TokenUsage = Field(default_factory=TokenUsage)


class RetrievalPayload(BaseModel):
    """Payload containing retrieval results."""

    response: RetrievalResponse
    usage: TokenUsage = Field(default_factory=TokenUsage)
