"""Wire contract for provider connections and the provider-type catalog.

The per-type stored-config models live in `app/schemas/provider_configs.py`;
this module owns the shapes that cross the API — the provider-type catalog the
add-connection form renders from, and the connection read/write payloads.
`ConnectionRead` never carries secret values — secret fields are echoed as
`secrets_configured` booleans only.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import (
    ChatCapabilities,
    ModelPricing,
    normalize_capability_markers,
)


class ConfigFieldKind(StrEnum):
    """Rendering kinds for provider config fields (drives the generic form)."""

    STRING = "string"
    SECRET = "secret"
    URL = "url"
    BOOLEAN = "boolean"
    SELECT = "select"


class ProviderConfigOption(BaseModel):
    """One choice of a `select` config field."""

    value: str
    label: str
    description: str | None = None


class ProviderConfigField(BaseModel):
    """One field of a provider type's connection config, for form rendering."""

    name: str
    label: str
    kind: ConfigFieldKind
    required: bool = True
    placeholder: str | None = None
    description: str | None = None
    #: Choices for a `select` field. The same set must be enforced by the
    #: config model's validator — a form-only constraint is bypassed by any
    #: caller that PATCHes the connection directly.
    options: tuple[ProviderConfigOption, ...] = ()
    #: Value the form starts from, so a probe-driven default is visible and
    #: editable rather than applied invisibly at save time.
    default: str | bool | None = None
    #: Fields a user only reaches after the probe disagrees with them. The
    #: add-connection form keeps them behind a disclosure so the common case
    #: stays one URL and one key.
    advanced: bool = False


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


class ServerProbeRequest(BaseModel):
    """An unsaved custom-server address to discover capabilities for."""

    base_url: str = Field(min_length=1)
    api_key: str | None = None


class ServerProbeResult(BaseModel):
    """What a discovery pass found on a custom server.

    Returned as a *suggestion*: the add-connection form pre-fills the
    capability toggles from it and the user confirms or corrects them. The
    stored connection records what the user confirmed, so a server that was
    briefly slow or down never silently loses a capability it has.
    """

    reachable: bool
    serves_chat: bool = False
    serves_embeddings: bool = False
    serves_reranking: bool = False
    serves_responses: bool = False
    #: True when a surface answered 401/403 rather than 404 — the key is the
    #: thing to fix, not the capability checkboxes.
    unauthorized: bool = False
    model_ids: list[str] = Field(default_factory=list)
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
    #: Sampling knobs only — capability markers are split out on construction.
    supported_parameters: list[str] = Field(default_factory=list)
    default_parameters: dict[str, Any] | None = None
    capabilities: ChatCapabilities = Field(default_factory=ChatCapabilities)
    #: True when the provider's own catalog marks the model deprecated —
    #: ordered last in pickers, never filtered out.
    deprecated: bool = False

    @model_validator(mode="after")
    def _split_markers(self) -> CatalogModel:
        """Keep capability claims out of the sampling-knob list."""
        normalize_capability_markers(self)
        return self


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
