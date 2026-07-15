"""Payload models used between pipeline nodes."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.pipelines.tracing.summaries import TokenUsage
from app.retrieval.models import (
    Document,
    DocumentChunk,
    EmbeddingVector,
    QueryRequest,
    RetrievalResponse,
)
from app.retrieval.parsers.base import DocumentSource


class TokenizerSpec(BaseModel):
    """Immutable tokenizer selection emitted by tokenizer resource nodes."""

    model_config = ConfigDict(frozen=True)

    kind: Literal["wordpiece", "cl100k", "whitespace", "huggingface"]
    hf_model_id: str | None = None

    @model_validator(mode="after")
    def validate_huggingface_model_id(self) -> TokenizerSpec:
        """Require a model id only for the HuggingFace tokenizer kind."""
        if self.kind == "huggingface" and not self.hf_model_id:
            raise ValueError("A HuggingFace tokenizer requires a model id.")
        if self.kind != "huggingface" and self.hf_model_id is not None:
            raise ValueError("Only a HuggingFace tokenizer accepts a model id.")
        return self


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
