"""Typed request and response envelopes for Cohere's HTTP API."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CohereModel(BaseModel):
    """One Cohere model returned by the v1 model catalog."""

    name: str
    endpoints: list[str] = Field(default_factory=list)
    context_length: int | None = None
    description: str | None = None
    input_types: list[str] = Field(default_factory=list)
    output_dimension: int | None = None


class CohereModelsResponse(BaseModel):
    """One page of Cohere's v1 models response."""

    models: list[CohereModel] = Field(default_factory=list)
    next_page_token: str | None = None


class CohereEmbeddings(BaseModel):
    """Embedding vectors grouped by the representation type Cohere returned."""

    values: list[list[float]] = Field(default_factory=list, alias="float")


class CohereUsageTokens(BaseModel):
    """Token and unit accounting supplied by Cohere.

    Reranking is billed per search unit and carries no token count, so a
    rerank response populates `search_units` alone.
    """

    input_tokens: int | None = None
    output_tokens: int | None = None
    search_units: int | None = None


class CohereUsage(BaseModel):
    """Usage data shared across v2 Cohere responses."""

    tokens: CohereUsageTokens | None = None
    billed_units: CohereUsageTokens | None = None


class CohereEmbedResponse(BaseModel):
    """Cohere's v2 embedding response."""

    embeddings: CohereEmbeddings
    meta: CohereUsage | None = None


class CohereRerankResult(BaseModel):
    """A reranked document's source index and relevance score."""

    index: int
    relevance_score: float


class CohereRerankResponse(BaseModel):
    """Cohere's v2 reranking response."""

    results: list[CohereRerankResult] = Field(default_factory=list)
    meta: CohereUsage | None = None


class CohereContent(BaseModel):
    """A text content block from Cohere's v2 chat API."""

    type: str | None = None
    text: str | None = None


class CohereToolFunction(BaseModel):
    """Function details on a Cohere tool call."""

    name: str | None = None
    arguments: str | None = None


class CohereToolCall(BaseModel):
    """A function tool call returned by Cohere."""

    id: str | None = None
    type: str | None = None
    function: CohereToolFunction = Field(default_factory=CohereToolFunction)


class CohereMessage(BaseModel):
    """The assistant message in a Cohere chat response or stream delta."""

    role: str | None = None
    content: list[CohereContent] | CohereContent | None = None
    tool_calls: list[CohereToolCall] | CohereToolCall | None = None
    tool_plan: str | None = None


class CohereChatDelta(BaseModel):
    """The mutable portion of one Cohere streaming event."""

    message: CohereMessage | None = None
    finish_reason: str | None = None
    usage: CohereUsage | None = None


class CohereChatResponse(BaseModel):
    """Cohere's non-streaming v2 chat response."""

    model: str | None = None
    message: CohereMessage = Field(default_factory=CohereMessage)
    finish_reason: str | None = None
    usage: CohereUsage | None = None


class CohereStreamEvent(BaseModel):
    """A parsed server-sent event from Cohere's v2 chat stream."""

    type: str
    index: int | None = None
    id: str | None = None
    delta: CohereChatDelta = Field(default_factory=CohereChatDelta)
    model: str | None = None
    raw: dict[str, Any] | None = None
