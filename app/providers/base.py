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
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConnectionValidationResult,
    ProviderConfigField,
)
from app.services.errors import InvalidInputError

ConfigT = TypeVar("ConfigT", bound=BaseModel)


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

    def require_kind(self, kind: ProviderKind) -> None:
        """Raise `InvalidInputError` when this provider type lacks a kind."""
        if kind not in self.descriptor.kinds:
            raise InvalidInputError(
                f"{self.descriptor.label} connections do not provide {kind.value} models."
            )

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

    def embedding_dimension(self, model_name: str) -> int | None:
        """Return the embedding dimension for a model, when discoverable."""
        raise InvalidInputError(
            f"{self.descriptor.label} connections do not provide embedding models."
        )
