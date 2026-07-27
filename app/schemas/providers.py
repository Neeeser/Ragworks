"""Wire contract for provider connections and the provider-type catalog.

The per-type connection config models (`OpenRouterConnectionConfig`, ...) are
the single validation point for what lands in `provider_connections.config`;
the connections service validates through them before writing, and adapters
read through them at construction time. `ConnectionRead` never carries secret
values — secret fields are echoed as `secrets_configured` booleans only.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import ModelPricing


class ConfigFieldKind(StrEnum):
    """Rendering kinds for provider config fields (drives the generic form)."""

    STRING = "string"
    SECRET = "secret"
    URL = "url"


class ProviderConfigField(BaseModel):
    """One field of a provider type's connection config, for form rendering."""

    name: str
    label: str
    kind: ConfigFieldKind
    required: bool = True
    placeholder: str | None = None
    description: str | None = None


class ProviderTypeRead(BaseModel):
    """One entry of the provider-type catalog (`GET /api/providers`).

    `builtin` entries (pgvector) need no connection; `available` reports
    whether a builtin is usable on this deployment.
    """

    provider_type: str
    label: str
    kinds: list[ProviderKind]
    config_fields: list[ProviderConfigField]
    docs_url: str | None = None
    max_connections_per_user: int | None = None
    recommended: bool = False
    builtin: bool = False
    available: bool = True


#: Port assumed for an Ollama server URL that names no port.
OLLAMA_DEFAULT_PORT = 11434
#: Port assumed for a Text Embeddings Inference server URL that names no port.
TEI_DEFAULT_PORT = 8080


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


class OpenRouterConnectionConfig(BaseModel):
    """Stored config for an OpenRouter connection."""

    api_key: str = Field(min_length=1)


class CohereConnectionConfig(BaseModel):
    """Stored config for a Cohere connection."""

    api_key: str = Field(min_length=1)


class OllamaConnectionConfig(BaseModel):
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


class PineconeConnectionConfig(BaseModel):
    """Stored config for a Pinecone connection."""

    api_key: str = Field(min_length=1)


class ConnectionCreate(BaseModel):
    """Payload for registering a provider connection."""

    provider_type: ProviderType
    label: str = Field(min_length=1, max_length=100)
    config: dict[str, Any]


class ConnectionUpdate(BaseModel):
    """Payload for editing a connection.

    `config` is a partial overlay: only the provided fields replace stored
    values, so relabeling never requires re-entering secrets.
    """

    label: str | None = Field(default=None, min_length=1, max_length=100)
    config: dict[str, Any] | None = None


class ConnectionRead(DateTimeConfigMixin, BaseModel):
    """A connection as returned to clients — secret values never included."""

    model_config = ConfigDict(**DateTimeConfigMixin.model_config)

    id: UUID
    provider_type: ProviderType
    label: str
    kinds: list[ProviderKind]
    # False when the stored config no longer validates: the row still lists
    # (visible and deletable) but must not satisfy capability gates.
    config_valid: bool = True
    config: dict[str, str]
    secrets_configured: dict[str, bool]
    created_at: datetime
    updated_at: datetime


class ConnectionValidateRequest(BaseModel):
    """An unsaved connection config to probe before creating it."""

    provider_type: ProviderType
    config: dict[str, Any]


class ConnectionValidationResult(BaseModel):
    """Outcome of probing a connection's credentials/reachability."""

    valid: bool
    message: str | None = None


class CatalogModel(BaseModel):
    """One selectable model qualified by the connection that serves it."""

    connection_id: UUID
    connection_label: str
    provider_type: ProviderType
    id: str
    name: str
    description: str | None = None
    context_length: int | None = None
    max_input_tokens: int | None = None
    pricing: ModelPricing | None = None
    dimension: int | None = None
    input_modalities: list[str] = Field(default_factory=list)
    output_modalities: list[str] = Field(default_factory=list)
    supported_parameters: list[str] = Field(default_factory=list)
    default_parameters: dict[str, Any] | None = None


class ConnectionCatalogError(BaseModel):
    """A connection whose catalog fetch failed while listing models."""

    connection_id: UUID
    connection_label: str
    message: str


class CatalogMetadata(BaseModel):
    """Freshness of the unified catalog returned to model selectors."""

    freshness: Literal["fresh", "stale"] = "fresh"
    age_seconds: float = Field(default=0, ge=0)
    refreshing: bool = False
    warning: str | None = None


class ModelCatalogResponse(BaseModel):
    """Unified model listing across every connection of the requested kind.

    One unreachable connection degrades to a `connection_errors` entry rather
    than failing the whole listing.
    """

    models: list[CatalogModel] = Field(default_factory=list)
    connection_errors: list[ConnectionCatalogError] = Field(default_factory=list)
    meta: CatalogMetadata = Field(default_factory=CatalogMetadata)


class EmbeddingDimensionResponse(BaseModel):
    """Dimension lookup qualified by the exact provider connection and model."""

    connection_id: UUID
    model_id: str
    dimension: int | None


class ProviderCoverage(BaseModel):
    """Which provider kinds the user's connections (plus builtins) cover."""

    has_embedding: bool
    has_chat: bool
    has_reranking: bool
    has_vector_store: bool
