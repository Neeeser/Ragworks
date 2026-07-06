"""Schema models for OpenRouter chat and embeddings responses."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

NumberLike = int | float | str


class OpenRouterUsage(BaseModel):
    """Usage details returned by OpenRouter."""

    model_config = ConfigDict(extra="allow")

    prompt_tokens: NumberLike | None = None
    completion_tokens: NumberLike | None = None
    total_tokens: NumberLike | None = None
    completion_tokens_details: dict[str, Any] | None = None
    prompt_tokens_details: dict[str, Any] | None = None
    reasoning_tokens: NumberLike | None = None
    cost: NumberLike | None = None


class OpenRouterFunctionCall(BaseModel):
    """Function call data returned by OpenRouter."""

    model_config = ConfigDict(extra="allow")

    name: str | None = None
    arguments: str | None = None
    id: str | None = None


class OpenRouterToolCall(BaseModel):
    """Tool call entry returned by OpenRouter."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    type: str | None = None
    function: OpenRouterFunctionCall | None = None
    index: int | None = None


class OpenRouterAssistantMessage(BaseModel):
    """Assistant message in chat responses."""

    model_config = ConfigDict(extra="allow")

    content: Any | None = None
    tool_calls: list[OpenRouterToolCall] | None = None
    reasoning: Any | None = None
    reasoning_content: Any | None = None


class OpenRouterChatChoice(BaseModel):
    """Choice entry in chat responses."""

    model_config = ConfigDict(extra="allow")

    index: int | None = None
    message: OpenRouterAssistantMessage | None = None
    finish_reason: str | None = None


class OpenRouterChatResponse(BaseModel):
    """Top-level chat response from OpenRouter."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    choices: list[OpenRouterChatChoice] = Field(default_factory=list)
    model: str | None = None
    provider: str | None = None
    usage: OpenRouterUsage | None = None


class OpenRouterStreamDelta(BaseModel):
    """Stream delta message from OpenRouter."""

    model_config = ConfigDict(extra="allow")

    content: Any | None = None
    tool_calls: list[OpenRouterToolCall] | None = None
    reasoning: Any | None = None


class OpenRouterStreamChoice(BaseModel):
    """Choice item for streaming responses."""

    model_config = ConfigDict(extra="allow")

    index: int | None = None
    delta: OpenRouterStreamDelta | None = None
    finish_reason: str | None = None


class OpenRouterStreamChunk(BaseModel):
    """Stream chunk payload for chat responses."""

    model_config = ConfigDict(extra="allow")

    choices: list[OpenRouterStreamChoice] = Field(default_factory=list)
    provider: str | None = None
    model: str | None = None
    usage: OpenRouterUsage | None = None


class OpenRouterEmbeddingItem(BaseModel):
    """Embedding item in embeddings response."""

    model_config = ConfigDict(extra="allow")

    object: str | None = None
    embedding: Any | None = None
    index: int | None = None


class OpenRouterEmbeddingsResponse(BaseModel):
    """Top-level embeddings response from OpenRouter."""

    model_config = ConfigDict(extra="allow")

    id: str | None = None
    object: str | None = None
    data: list[OpenRouterEmbeddingItem] | None = None
    model: str | None = None
    usage: OpenRouterUsage | None = None


class OpenRouterKeyRateLimit(BaseModel):
    """Legacy rate-limit block on key metadata; OpenRouter always returns -1 here."""

    model_config = ConfigDict(extra="allow")

    requests: NumberLike | None = None
    interval: str | None = None
    note: str | None = None


class OpenRouterKeyData(BaseModel):
    """Metadata for the API key associated with the current session.

    Shape per `external_api_documentation/openrouter-docs/api/api-reference/
    api-keys/get-current-key.md` (GET /key).
    """

    model_config = ConfigDict(extra="allow")

    label: str | None = None
    limit: NumberLike | None = None
    usage: NumberLike | None = None
    usage_daily: NumberLike | None = None
    usage_weekly: NumberLike | None = None
    usage_monthly: NumberLike | None = None
    byok_usage: NumberLike | None = None
    byok_usage_daily: NumberLike | None = None
    byok_usage_weekly: NumberLike | None = None
    byok_usage_monthly: NumberLike | None = None
    is_free_tier: bool | None = None
    is_provisioning_key: bool | None = None
    limit_remaining: NumberLike | None = None
    limit_reset: str | None = None
    include_byok_in_limit: bool | None = None
    expires_at: str | None = None
    rate_limit: OpenRouterKeyRateLimit | None = None


class OpenRouterKeyInfo(BaseModel):
    """Top-level response from `GET /key` (current API key metadata)."""

    model_config = ConfigDict(extra="allow")

    data: OpenRouterKeyData
