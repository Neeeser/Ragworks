"""Adapter construction: the single place provider adapters are built.

`get_provider` is also the single enforcement point for provider
prerequisites: an unknown provider type, malformed config, or a kind the
provider doesn't serve raises `InvalidInputError` (→ 400), and a connection
that doesn't exist for the user raises `NotFoundError` (→ 404).
`ProviderResolver` wraps it lazily for pipeline runs and chat turns so a run
only constructs the adapters it actually touches.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from sqlmodel import Session

from app.cache import CachePolicy, ValueCache
from app.clients.ollama.client import (
    close_ollama_clients,
    invalidate_ollama_client,
)
from app.clients.openrouter.client import (
    close_openrouter_clients,
    invalidate_openrouter_client,
)
from app.db import models
from app.db.repositories import ProviderConnectionRepository
from app.providers.base import ProviderAdapter, ProviderDescriptor
from app.providers.chat.base import ChatProvider
from app.providers.ollama import OllamaAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.providers.pinecone import PineconeAdapter
from app.retrieval.embedders.base import Embedder
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import OllamaConnectionConfig, OpenRouterConnectionConfig
from app.services.errors import InvalidInputError, NotFoundError

ADAPTERS: dict[ProviderType, type[ProviderAdapter]] = {
    ProviderType.OPENROUTER: OpenRouterAdapter,
    ProviderType.OLLAMA: OllamaAdapter,
    ProviderType.PINECONE: PineconeAdapter,
}

CONNECTION_REMOVED_DETAIL = (
    "The provider connection this uses was removed. Pick another provider in Settings."
)

_dimension_cache = ValueCache[tuple[UUID, str], int | None](
    CachePolicy(
        fresh_seconds=None,
        max_stale_seconds=0,
        failure_retry_seconds=30,
        max_entries=1024,
    )
)


def _invalidate_openrouter(config: dict[str, object]) -> None:
    parsed = OpenRouterConnectionConfig.model_validate(config)
    invalidate_openrouter_client(parsed.api_key)


def _invalidate_ollama(config: dict[str, object]) -> None:
    parsed = OllamaConnectionConfig.model_validate(config)
    invalidate_ollama_client(parsed.base_url, parsed.api_key)


_CACHE_INVALIDATORS: dict[ProviderType, Callable[[dict[str, object]], None]] = {
    ProviderType.OPENROUTER: _invalidate_openrouter,
    ProviderType.OLLAMA: _invalidate_ollama,
}


def all_descriptors() -> list[ProviderDescriptor]:
    """Return every registered provider type's descriptor (stable order)."""
    return [adapter.descriptor for adapter in ADAPTERS.values()]


def descriptor_for(provider_type: ProviderType) -> ProviderDescriptor:
    """Return the descriptor for one provider type."""
    return ADAPTERS[provider_type].descriptor


def build_adapter(connection: models.ProviderConnection) -> ProviderAdapter:
    """Construct the adapter for a connection row, validating its config."""
    try:
        provider_type = ProviderType(connection.provider_type)
    except ValueError as exc:
        raise InvalidInputError(
            f"Unknown provider type '{connection.provider_type}'."
        ) from exc
    return ADAPTERS[provider_type](connection)


def resolve_connection(
    session: Session,
    user: models.User,
    connection_id: UUID,
) -> models.ProviderConnection:
    """Return the user's connection or raise `NotFoundError`.

    A connection owned by another user is indistinguishable from a missing
    one (the same cross-user-404 contract as every other resource). The
    error message covers the common real cause: the connection was deleted
    while something (a pipeline, a chat session) still referenced it.
    """
    connection = ProviderConnectionRepository(session).get_owned(connection_id, user.id)
    if connection is None:
        raise NotFoundError(CONNECTION_REMOVED_DETAIL)
    return connection


def get_provider(
    connection: models.ProviderConnection,
    kind: ProviderKind,
) -> ProviderAdapter:
    """Construct a connection's adapter, enforcing that it serves `kind`."""
    adapter = build_adapter(connection)
    adapter.require_kind(kind)
    return adapter


def cached_embedding_dimension(
    connection_id: UUID,
    model_id: str,
    loader: Callable[[], int | None],
) -> int | None:
    """Return a dimension keyed by exact connection and model identity.

    An unknown (`None`) dimension is returned but never retained: the policy
    is indefinite-fresh, so caching it would pin "unknown" until the next
    connection mutation instead of re-probing on the next lookup.
    """
    key = (connection_id, model_id)
    dimension = _dimension_cache.get(key, loader).value
    if dimension is None:
        _dimension_cache.invalidate(key)
    return dimension


def invalidate_embedding_dimensions(connection_id: UUID) -> int:
    """Drop dimension values owned by one changed or deleted connection."""
    return _dimension_cache.invalidate_matching(lambda key: key[0] == connection_id)


def invalidate_connection_caches(connection: models.ProviderConnection) -> None:
    """Close resources derived from a connection's stored configuration."""
    provider_type = ProviderType(connection.provider_type)
    invalidator = _CACHE_INVALIDATORS.get(provider_type)
    if invalidator is not None:
        invalidator(connection.config)


def close_provider_clients() -> None:
    """Close all provider-owned caches and resources during application shutdown."""
    _dimension_cache.close()
    close_openrouter_clients()
    close_ollama_clients()


class ProviderResolver:
    """Lazy per-run adapter factory bound to one user and session.

    Replaces the raw `OpenRouterClient` on `PipelineRunContext`: adapters are
    constructed on first use and cached for the run, so a run only pays for
    the connections its nodes actually reference.
    """

    def __init__(self, user: models.User, session: Session) -> None:
        """Bind the resolver to the run's user and session."""
        self._user = user
        self._session = session
        self._adapters: dict[tuple[UUID, ProviderKind], ProviderAdapter] = {}

    def adapter(self, connection_id: UUID, kind: ProviderKind) -> ProviderAdapter:
        """Return the (cached) kind-checked adapter for a connection id."""
        cache_key = (connection_id, kind)
        if cache_key not in self._adapters:
            connection = resolve_connection(self._session, self._user, connection_id)
            self._adapters[cache_key] = get_provider(connection, kind)
        return self._adapters[cache_key]

    def embedder(
        self,
        connection_id: UUID,
        model_name: str,
        dimensions: int | None = None,
    ) -> Embedder:
        """Construct an embedder from a connection id and model name."""
        return self.adapter(connection_id, ProviderKind.EMBEDDING).embedder(
            model_name, dimensions=dimensions
        )

    def embedding_input_limit(self, connection_id: UUID, model_name: str) -> int | None:
        """Return the provider-published embedding input limit when known."""
        return self.adapter(
            connection_id, ProviderKind.EMBEDDING
        ).embedding_input_limit(model_name)

    def chat(self, connection_id: UUID) -> ChatProvider:
        """Construct a chat provider from a connection id."""
        return self.adapter(connection_id, ProviderKind.CHAT).chat_provider()
