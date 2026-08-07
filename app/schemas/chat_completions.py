"""Wire shapes for the OpenAI Chat Completions dialect.

These models describe the `/v1/chat/completions`, `/v1/embeddings`, and
`/v1/rerank` payloads that OpenAI, OpenRouter, vLLM, llama.cpp, LM Studio, and
every other OpenAI-compatible server speak. They are deliberately permissive
(`extra="allow"`, every field optional) because "OpenAI-compatible" is a family
of near-misses rather than one spec: a self-hosted server that omits `usage` or
adds a vendor field must still parse, or the dialect only works against the one
implementation it was written from.

Fields that originate with a single vendor but ride the same envelope
(`provider`, `reasoning`) live here rather than in a subclass — they are
optional, so a server that never sends them is unaffected, and a dialect that
had to know which subclass to validate against would defeat the point of
sharing one parser.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

NumberLike = int | float | str


class ChatUsage(BaseModel):
    """Token accounting returned alongside a chat or embeddings response."""

    model_config = ConfigDict(extra="allow")

    prompt_tokens: NumberLike | None = None
    completion_tokens: NumberLike | None = None
    total_tokens: NumberLike | None = None
    completion_tokens_details: dict[str, Any] | None = None
    prompt_tokens_details: dict[str, Any] | None = None
    reasoning_tokens: NumberLike | None = None
    cost: NumberLike | None = None


class ChatFunctionCall(BaseModel):
    """The function half of a tool call (name plus JSON-encoded arguments)."""

    model_config = ConfigDict(extra="allow")

    name: str | None = None
    arguments: str | None = None
    id: str | None = None


class ChatToolCall(BaseModel):
    """One tool call requested by the assistant."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    type: str | None = None
    function: ChatFunctionCall | None = None
    index: int | None = None


class ChatAssistantMessage(BaseModel):
    """The assistant message carried by a non-streaming choice."""

    model_config = ConfigDict(extra="allow")

    content: Any | None = None
    tool_calls: list[ChatToolCall] | None = None
    reasoning: Any | None = None
    reasoning_content: Any | None = None


class ChatChoice(BaseModel):
    """One completion choice in a non-streaming response."""

    model_config = ConfigDict(extra="allow")

    index: int | None = None
    message: ChatAssistantMessage | None = None
    finish_reason: str | None = None


class ChatCompletionResponse(BaseModel):
    """Top-level non-streaming chat completion payload."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    choices: list[ChatChoice] = Field(default_factory=list)
    model: str | None = None
    provider: str | None = None
    usage: ChatUsage | None = None


class ChatStreamDelta(BaseModel):
    """Incremental assistant content in a streaming chunk."""

    model_config = ConfigDict(extra="allow")

    content: Any | None = None
    tool_calls: list[ChatToolCall] | None = None
    reasoning: Any | None = None
    reasoning_content: Any | None = None


class ChatStreamChoice(BaseModel):
    """One choice inside a streaming chunk."""

    model_config = ConfigDict(extra="allow")

    index: int | None = None
    delta: ChatStreamDelta | None = None
    finish_reason: str | None = None


class ChatCompletionChunk(BaseModel):
    """One server-sent chunk of a streaming chat completion."""

    model_config = ConfigDict(extra="allow")

    choices: list[ChatStreamChoice] = Field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    usage: ChatUsage | None = None


class EmbeddingItem(BaseModel):
    """One vector in an embeddings response."""

    model_config = ConfigDict(extra="allow")

    object: str | None = None
    embedding: Any | None = None
    index: int | None = None


class EmbeddingsResponse(BaseModel):
    """Top-level embeddings payload.

    `error` is modelled because providers return the error envelope with a 200
    in place of `data`; without it the failure surfaces as a missing-key crash
    far from the provider that caused it.
    """

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    object: str | None = None
    data: list[EmbeddingItem] | None = None
    model: str | None = None
    usage: ChatUsage | None = None
    error: dict[str, Any] | None = None


class RerankResult(BaseModel):
    """One scored document index from a rerank response."""

    model_config = ConfigDict(extra="allow")

    index: int
    relevance_score: float


class RerankDocument(BaseModel):
    """One candidate as a rerank endpoint reads it.

    A multimodal rerank model scores a page image directly, so a document
    is text, an image, or both. `image` is a data URI or remote URL. A
    document carrying only text still travels as a bare string on the
    wire, which is the one form every text-only endpoint accepts.
    """

    text: str | None = None
    image: str | None = None


class RerankResponse(BaseModel):
    """Top-level rerank payload in the Jina/Cohere `results` shape."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    model: str | None = None
    provider: str | None = None
    results: list[RerankResult] = Field(default_factory=list)
    usage: ChatUsage | None = None


class ModelListEntry(BaseModel):
    """One entry of an OpenAI-compatible `GET /v1/models` listing.

    Only `id` is guaranteed by the spec; everything else is best-effort
    enrichment that individual servers may or may not publish.
    """

    model_config = ConfigDict(extra="allow")

    id: str
    object: str | None = None
    owned_by: str | None = None
    created: int | None = None


class ModelListResponse(BaseModel):
    """Envelope for an OpenAI-compatible model listing."""

    model_config = ConfigDict(extra="allow")

    object: str | None = None
    data: list[ModelListEntry] = Field(default_factory=list)
