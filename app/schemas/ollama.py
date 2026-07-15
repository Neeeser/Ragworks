"""Typed request/response models for the official Ollama HTTP API.

Shapes follow the current Ollama API docs (`/api/tags`, `/api/show`,
`/api/embed`, `/api/chat`, `/api/version`). All models allow extra fields —
Ollama adds keys between releases and the client must not break on them.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class OllamaModelDetails(BaseModel):
    """Family/quantization metadata attached to a local model."""

    model_config = ConfigDict(extra="allow")

    family: str | None = None
    families: list[str] | None = None
    parameter_size: str | None = None
    quantization_level: str | None = None


class OllamaModelSummary(BaseModel):
    """One entry from `GET /api/tags` (a locally available model)."""

    model_config = ConfigDict(extra="allow", protected_namespaces=())

    name: str
    model: str | None = None
    size: int | None = None
    digest: str | None = None
    details: OllamaModelDetails | None = None


class OllamaTagsResponse(BaseModel):
    """Envelope for `GET /api/tags`."""

    model_config = ConfigDict(extra="allow")

    models: list[OllamaModelSummary] = Field(default_factory=list)


class OllamaShowResponse(BaseModel):
    """Envelope for `POST /api/show` (detailed model information).

    `capabilities` distinguishes what a model can do — `"completion"`,
    `"embedding"`, `"tools"`, `"thinking"`, `"vision"` — and drives kind
    classification in the catalog. `model_info` keys are architecture-prefixed
    (e.g. `llama.context_length`), so it stays an open dict.
    """

    model_config = ConfigDict(extra="allow", protected_namespaces=())

    capabilities: list[str] = Field(default_factory=list)
    details: OllamaModelDetails | None = None
    model_info: dict[str, Any] = Field(default_factory=dict)


class OllamaEmbedResponse(BaseModel):
    """Envelope for `POST /api/embed`."""

    model_config = ConfigDict(extra="allow", protected_namespaces=())

    model: str | None = None
    embeddings: list[list[float]] = Field(default_factory=list)
    prompt_eval_count: int | None = None


class OllamaToolCallFunction(BaseModel):
    """Function payload of a tool call emitted by a chat model."""

    model_config = ConfigDict(extra="allow")

    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class OllamaToolCall(BaseModel):
    """One tool call in a chat message (Ollama issues no call ids)."""

    model_config = ConfigDict(extra="allow")

    function: OllamaToolCallFunction


class OllamaChatMessage(BaseModel):
    """A chat message in `POST /api/chat` responses."""

    model_config = ConfigDict(extra="allow")

    role: str = "assistant"
    content: str = ""
    thinking: str | None = None
    tool_calls: list[OllamaToolCall] | None = None


class OllamaChatResponse(BaseModel):
    """One `POST /api/chat` response object.

    Streaming responses are NDJSON lines of this same shape with partial
    `message` content and `done: false`; the final line carries `done: true`
    plus the eval counters.
    """

    model_config = ConfigDict(extra="allow", protected_namespaces=())

    model: str | None = None
    message: OllamaChatMessage | None = None
    done: bool = False
    done_reason: str | None = None
    prompt_eval_count: int | None = None
    eval_count: int | None = None
    error: str | None = None


class OllamaModelDescription(BaseModel):
    """A capability-classified local model, assembled from tags + show.

    `embedding_dimension` comes from the model's architecture metadata
    (`{arch}.embedding_length`) — read without loading the model, unlike an
    embed probe. `context_length` likewise from `{arch}.context_length`.
    """

    name: str
    capabilities: list[str] = Field(default_factory=list)
    parameter_size: str | None = None
    quantization_level: str | None = None
    context_length: int | None = None
    embedding_dimension: int | None = None


class OllamaVersionResponse(BaseModel):
    """Envelope for `GET /api/version`."""

    model_config = ConfigDict(extra="allow")

    version: str
