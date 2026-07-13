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
from typing import Any
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


class OpenRouterConnectionConfig(BaseModel):
    """Stored config for an OpenRouter connection."""

    api_key: str = Field(min_length=1)


class OllamaConnectionConfig(BaseModel):
    """Stored config for an Ollama connection."""

    base_url: str = Field(min_length=1)
    api_key: str | None = None

    @field_validator("base_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        """Require an http(s) URL and strip the trailing slash."""
        cleaned = value.strip().rstrip("/")
        if not cleaned.startswith(("http://", "https://")):
            raise ValueError("Base URL must start with http:// or https://.")
        return cleaned


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
    pricing: ModelPricing | None = None
    dimension: int | None = None
    supported_parameters: list[str] = Field(default_factory=list)
    default_parameters: dict[str, Any] | None = None


class ConnectionCatalogError(BaseModel):
    """A connection whose catalog fetch failed while listing models."""

    connection_id: UUID
    connection_label: str
    message: str


class ModelCatalogResponse(BaseModel):
    """Unified model listing across every connection of the requested kind.

    One unreachable connection degrades to a `connection_errors` entry rather
    than failing the whole listing.
    """

    models: list[CatalogModel] = Field(default_factory=list)
    connection_errors: list[ConnectionCatalogError] = Field(default_factory=list)


class ProviderCoverage(BaseModel):
    """Which provider kinds the user's connections (plus builtins) cover."""

    has_embedding: bool
    has_chat: bool
    has_vector_store: bool
