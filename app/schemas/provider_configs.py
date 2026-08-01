"""Per-type stored configuration for provider connections.

These models are the single validation point for what lands in
`provider_connections.config`: the connections service validates through them
before writing, and adapters read through them at construction time. They live
apart from the connection *wire* contract because they are the only place a
provider's own vocabulary appears — a server's default port, which chat API it
speaks, which rerank shape its endpoint serves.
"""

from __future__ import annotations

from enum import StrEnum
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, Field, field_validator

#: Port assumed for an Ollama server URL that names no port.
OLLAMA_DEFAULT_PORT = 11434
#: Port assumed for a Text Embeddings Inference server URL that names no port.
TEI_DEFAULT_PORT = 8080
#: Port assumed for a generic OpenAI-compatible server URL that names no port.
#: vLLM's default, and what llama.cpp's server documents first.
OPENAI_COMPAT_DEFAULT_PORT = 8000


def normalize_server_url(value: str, default_port: int) -> str:
    """Normalize a self-hosted server URL into one that actually resolves.

    A host typed without a scheme (``192.168.1.50:11434``) or without a port
    (``http://192.168.1.50``) is what a user reads off their own machine, but
    the first is rejected outright and the second silently means port 80 — so
    the connection fails with a network error that says nothing about the URL.
    Assume ``http`` for a bare host, and `default_port` when an ``http`` URL
    names no port; an explicitly typed port (including ``:80``) is always
    preserved. An ``https`` URL is left alone — https implies 443 and a proxied
    endpoint, so assuming a self-hosted port there breaks the URL instead of
    fixing it.

    Parsing goes through `urlsplit` rather than string matching so IPv6
    literals (``http://[::1]``) and userinfo survive untouched.
    """
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("Server URL must not be empty.")
    # urlsplit reads a bare "host:port" as scheme "host" with path "port", so
    # the scheme has to be settled before anything else can be trusted. The
    # trailing slash is stripped from the parsed path, not from the raw string:
    # stripping first turns "http://" into "http:", which then reparses as the
    # host "http".
    if "://" not in cleaned:
        cleaned = f"http://{cleaned}"
    parts = urlsplit(cleaned)
    parts = parts._replace(path=parts.path.rstrip("/"))
    if parts.scheme not in ("http", "https"):
        raise ValueError("Base URL must start with http:// or https://.")
    if not parts.hostname:
        raise ValueError("Base URL must include a host.")
    try:
        port = parts.port
    except ValueError as exc:  # non-numeric port — urlsplit raises on access
        raise ValueError("Base URL port must be a number.") from exc
    if port is None and parts.scheme == "http":
        parts = parts._replace(netloc=f"{parts.netloc}:{default_port}")
    return urlunsplit(parts)


class LlmConcurrencyConfig(BaseModel):
    """Mixin for chat-capable connections: the LLM-call concurrency cap.

    `None` falls back to the provider type's default (a starter-tier-safe
    number declared on the adapter). The connection is the right scope — a
    laptop Ollama and a tier-4 cloud key differ by orders of magnitude, and
    every pipeline node sharing the connection shares its budget.
    """

    max_concurrent_requests: int | None = Field(default=None, ge=1, le=64)


class OpenRouterConnectionConfig(LlmConcurrencyConfig):
    """Stored config for an OpenRouter connection."""

    api_key: str = Field(min_length=1)


class CohereConnectionConfig(LlmConcurrencyConfig):
    """Stored config for a Cohere connection."""

    api_key: str = Field(min_length=1)


class OllamaConnectionConfig(LlmConcurrencyConfig):
    """Stored config for an Ollama connection."""

    base_url: str = Field(min_length=1)
    api_key: str | None = None

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        """Normalize the server URL, assuming Ollama's default port."""
        return normalize_server_url(value, OLLAMA_DEFAULT_PORT)


class TEIConnectionConfig(BaseModel):
    """Stored config for a Text Embeddings Inference connection."""

    base_url: str = Field(min_length=1)
    api_key: str | None = None

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        """Normalize the server URL, assuming TEI's default port."""
        return normalize_server_url(value, TEI_DEFAULT_PORT)


class ChatDialect(StrEnum):
    """Wire format a custom connection's chat calls use.

    A property of the *connection*, not the model: the operator of a
    self-hosted or gateway server knows which surface it speaks. OpenAI
    connections don't carry one — the same model answers the two surfaces
    with *different* capability profiles there, so the provider pins
    Responses (OpenAI's primary endpoint) and gateways use Custom.
    """

    CHAT_COMPLETIONS = "chat_completions"
    RESPONSES = "responses"


class OpenAIConnectionConfig(LlmConcurrencyConfig):
    """Stored config for an OpenAI connection."""

    api_key: str = Field(min_length=1)
    #: Set only to reach an OpenAI-compatible gateway on the account's behalf;
    #: empty means api.openai.com.
    base_url: str | None = None

    @field_validator("base_url")
    @classmethod
    def normalize_optional_base_url(cls, value: str | None) -> str | None:
        """Normalize an override URL, leaving an unset one alone."""
        if value is None or not value.strip():
            return None
        return normalize_server_url(value, OPENAI_COMPAT_DEFAULT_PORT)


class AnthropicConnectionConfig(LlmConcurrencyConfig):
    """Stored config for an Anthropic connection."""

    api_key: str = Field(min_length=1)
    base_url: str | None = None

    @field_validator("base_url")
    @classmethod
    def normalize_optional_base_url(cls, value: str | None) -> str | None:
        """Normalize an override URL, leaving an unset one alone."""
        if value is None or not value.strip():
            return None
        return normalize_server_url(value, OPENAI_COMPAT_DEFAULT_PORT)


class RerankDialect(StrEnum):
    """Request/response shape a rerank endpoint speaks."""

    JINA_COHERE = "jina_cohere"
    TEI = "tei"


class CustomConnectionConfig(LlmConcurrencyConfig):
    """Stored config for a server reached through the standard APIs.

    The capability flags are what the probe writes and the user may correct.
    They default to on because a server that does not serve a surface answers
    404 there, which the adapter reports as the provider's own error — whereas
    defaulting them off would hide a working endpoint behind a checkbox the
    user has no reason to look for.
    """

    base_url: str = Field(min_length=1)
    api_key: str | None = None
    chat_dialect: ChatDialect = ChatDialect.CHAT_COMPLETIONS
    serves_chat: bool = True
    serves_embeddings: bool = True
    serves_reranking: bool = False
    rerank_path: str = "/rerank"
    rerank_dialect: RerankDialect = RerankDialect.JINA_COHERE

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        """Normalize the server URL, assuming the common self-hosted port."""
        return normalize_server_url(value, OPENAI_COMPAT_DEFAULT_PORT)

    @field_validator("rerank_path")
    @classmethod
    def validate_rerank_path(cls, value: str) -> str:
        """Keep the rerank path a root-relative path, not a second base URL."""
        cleaned = value.strip() or "/rerank"
        if not cleaned.startswith("/"):
            cleaned = f"/{cleaned}"
        return cleaned


class PineconeConnectionConfig(BaseModel):
    """Stored config for a Pinecone connection."""

    api_key: str = Field(min_length=1)
