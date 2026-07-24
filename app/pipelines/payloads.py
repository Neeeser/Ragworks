"""Payload models used between pipeline nodes."""

from __future__ import annotations

from collections.abc import Mapping
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
from app.vectorstores.base import FacetBucket

#: One structured output value: a scalar, or a facet-bucket list (the facet
#: tool's grouped counts). Widening this union is how a new structured value
#: shape joins the tool-result plane — `dump_outputs` must stay in lockstep.
StructuredValue = int | float | str | bool | list[FacetBucket]


def dump_outputs(outputs: Mapping[str, StructuredValue]) -> dict[str, object]:
    """Return a JSON-safe view of structured outputs.

    Scalars pass through; facet buckets dump to plain dicts. Every boundary
    that leaves the typed payload world (the wire response, the query-event
    JSON column, trace summary values) goes through this one function.
    """
    return {
        key: [bucket.model_dump() for bucket in value] if isinstance(value, list) else value
        for key, value in outputs.items()
    }


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
    tokenizer: TokenizerSpec = Field(default_factory=lambda: TokenizerSpec(kind="wordpiece"))


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


class StructuredValuesPayload(BaseModel):
    """Named structured values produced by a structured tool node.

    The `tool.output` terminal merges every inbound values payload into the
    result's `outputs` — for structured tools, these ARE the tool result.
    """

    values: dict[str, StructuredValue] = Field(default_factory=dict)
    usage: TokenUsage = Field(default_factory=TokenUsage)


class RetrievalPayload(BaseModel):
    """Payload containing retrieval results.

    `outputs` carries the extra named values the retrieval output node
    evaluated from its declared output expressions; empty for pipelines that
    declare none.
    """

    response: RetrievalResponse
    usage: TokenUsage = Field(default_factory=TokenUsage)
    outputs: dict[str, StructuredValue] = Field(default_factory=dict)
