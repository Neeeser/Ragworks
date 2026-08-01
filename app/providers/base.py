"""Provider adapter base: descriptors as data, one adapter class per type.

Mirrors the `app/vectorstores/` pattern: a frozen descriptor declares what a
provider type is (its capability kinds, config fields, connection limits) in
exactly one place, and every enforcement site — connection validation, the
add-connection form, kind gating — reads it off the adapter class rather than
re-hardcoding provider facts elsewhere.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar, TypeVar

from pydantic import BaseModel, ConfigDict, ValidationError

from app.db.models import ProviderConnection
from app.providers.chat.base import ChatProvider
from app.retrieval.embedders.base import Embedder
from app.retrieval.rerankers.base import Reranker
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConfigFieldKind,
    ConnectionValidationResult,
    ProviderConfigField,
)
from app.services.errors import InvalidInputError

ConfigT = TypeVar("ConfigT", bound=BaseModel)

EMBEDDING_INPUT_MARGIN_TOKENS = 16


def effective_embedding_input_limit(published_limit: int) -> int:
    """Reserve provider-agnostic headroom for embedding input wrappers."""
    return max(0, published_limit - EMBEDDING_INPUT_MARGIN_TOKENS)


def llm_rpm_field(default: int | None) -> ProviderConfigField:
    """The shared `requests_per_minute` form field for chat providers.

    Declared per descriptor so the add-connection form renders it with zero
    provider-specific frontend code; a `None` default means the provider is
    unpaced unless the user sets a value.
    """
    return ProviderConfigField(
        name="requests_per_minute",
        label="Requests per minute",
        kind=ConfigFieldKind.STRING,
        required=False,
        placeholder=str(default) if default is not None else "unlimited",
        description="Pace pipeline LLM calls to this many requests per minute.",
        help=(
            "Pipeline LLM nodes pace their calls across a sliding one-minute "
            "window so a large ingestion doesn't burn straight into the "
            "provider's rate limit. Raise it to match your account's tier; "
            "empty uses the provider default"
            + (f" ({default})." if default is not None else " (no pacing).")
        ),
        advanced=True,
    )


def llm_concurrency_field(default: int) -> ProviderConfigField:
    """The shared `max_concurrent_requests` form field for chat providers.

    Declared per descriptor (with the provider's own default as the
    placeholder) so the add-connection form renders it with zero
    provider-specific frontend code.
    """
    return ProviderConfigField(
        name="max_concurrent_requests",
        label="Max concurrent requests",
        kind=ConfigFieldKind.STRING,
        required=False,
        placeholder=str(default),
        description="Concurrent LLM calls pipeline nodes may make through this connection.",
        help=(
            "Pipeline LLM nodes fan per-chunk calls out in parallel; this caps how "
            "many run at once through this connection, across all pipelines. Raise "
            "it if your account's rate tier allows more; lower it for constrained "
            f"servers. Empty uses the provider default ({default})."
        ),
        advanced=True,
    )


@dataclass(frozen=True)
class CatalogResult:
    """One provider connection's shaped models and cache metadata."""

    models: list[CatalogModel]
    meta: CatalogMetadata


class ProviderDescriptor(BaseModel):
    """Declarative facts about one provider type (capabilities as data)."""

    model_config = ConfigDict(frozen=True)

    provider_type: ProviderType
    label: str
    kinds: tuple[ProviderKind, ...]
    config_fields: tuple[ProviderConfigField, ...]
    docs_url: str | None = None
    max_connections_per_user: int | None = None
    recommended: bool = False


class ProviderAdapter(ABC):
    """One configured provider connection, exposing kind-specific factories.

    Subclasses declare their `provider_type` + `descriptor` classvars, parse
    `connection.config` through their config model in `__init__`, and override
    the factories for the kinds they serve. The base implementations raise
    `InvalidInputError` so a kind mismatch is a 400 with a clear message, not
    an `AttributeError`.
    """

    provider_type: ClassVar[ProviderType]
    descriptor: ClassVar[ProviderDescriptor]

    def __init__(self, connection: ProviderConnection) -> None:
        """Bind the adapter to its connection row."""
        self.connection = connection

    @classmethod
    def parse_config(cls, config_model: type[ConfigT], config: dict[str, object]) -> ConfigT:
        """Validate a raw config dict, mapping failures to `InvalidInputError`."""
        try:
            return config_model.model_validate(config)
        except ValidationError as exc:
            raise InvalidInputError(
                f"Invalid {cls.descriptor.label} connection configuration: {exc.errors()[0]['msg']}"
            ) from exc

    def normalized_config(self) -> dict[str, object]:
        """Config as this provider's own model validated it, for persistence.

        A config model may rewrite what the user typed (assuming a scheme or a
        default port). Storing the raw dict instead leaves the row — and every
        listing built from it — showing an address that is not the one the
        provider is actually reached at. Adapters whose model normalizes
        override this; the rest store what they were given.
        """
        return dict(self.connection.config)

    def require_kind(self, kind: ProviderKind) -> None:
        """Raise `InvalidInputError` when this provider type lacks a kind."""
        if kind not in self.kinds:
            raise InvalidInputError(
                f"{self.descriptor.label} connections do not provide {kind.value} models."
            )

    @property
    def kinds(self) -> tuple[ProviderKind, ...]:
        """Return the capabilities served by this configured connection."""
        return self.descriptor.kinds

    @abstractmethod
    def validate_connection(self) -> ConnectionValidationResult:
        """Probe the connection's credentials/reachability."""

    def list_models(
        self, kind: ProviderKind, *, force_refresh: bool = False
    ) -> CatalogResult:
        """Return the connection's models of one kind (empty by default)."""
        del force_refresh
        self.require_kind(kind)
        return CatalogResult(models=[], meta=CatalogMetadata())

    def embedder(self, model_name: str, dimensions: int | None = None) -> Embedder:
        """Construct an embedder for a model served by this connection."""
        raise InvalidInputError(
            f"{self.descriptor.label} connections do not provide embedding models."
        )

    def chat_provider(self) -> ChatProvider:
        """Construct a chat provider backed by this connection."""
        raise InvalidInputError(
            f"{self.descriptor.label} connections do not provide chat models."
        )

    #: Concurrent-LLM-call cap when the connection sets none. Starter-tier
    #: safe per provider type; adapters serving CHAT override to match their
    #: provider's published entry limits.
    default_llm_concurrency: ClassVar[int] = 4

    #: Requests-per-minute pace when the connection sets none. `None` means
    #: unpaced — right for providers that publish no router-side cap
    #: (OpenRouter paid models) and for local servers, where reactive
    #: backoff is the only limit that means anything.
    default_llm_rpm: ClassVar[int | None] = None

    def llm_requests_per_minute(self) -> int | None:
        """Requests-per-minute pace for pipeline LLM calls, or None (unpaced).

        Reads the stored `requests_per_minute` override, falling back to the
        provider type's default. Malformed stored values fall back rather
        than raise — a throttle must never be what breaks a run.
        """
        raw = self.connection.config.get("requests_per_minute")
        try:
            value = int(str(raw)) if raw is not None and str(raw).strip() else None
        except ValueError:
            value = None
        if value is not None and value >= 1:
            return value
        return self.default_llm_rpm

    def llm_concurrency(self) -> int:
        """Concurrent LLM calls pipeline nodes may make through this connection.

        Reads the stored `max_concurrent_requests` override, falling back to
        the provider type's default. Malformed stored values fall back rather
        than raise — a throttle must never be what breaks a run.
        """
        raw = self.connection.config.get("max_concurrent_requests")
        try:
            value = int(str(raw)) if raw is not None and str(raw).strip() else None
        except ValueError:
            value = None
        if value is not None and value >= 1:
            return min(value, 64)
        return self.default_llm_concurrency

    def reranker(self, model_name: str) -> Reranker:
        """Construct a reranker for a model served by this connection."""
        del model_name
        raise InvalidInputError(
            f"{self.descriptor.label} connections do not provide reranking models."
        )

    def embedding_dimension(self, model_name: str) -> int | None:
        """Return the embedding dimension for a model, when discoverable."""
        raise InvalidInputError(
            f"{self.descriptor.label} connections do not provide embedding models."
        )

    def embedding_input_limit(self, model_name: str) -> int | None:
        """Return the provider-published embedding input limit, when known."""
        raise InvalidInputError(
            f"{self.descriptor.label} connections do not provide embedding models."
        )
