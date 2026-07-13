"""Adapter construction: the single place provider adapters are built.

`get_provider` is also the single enforcement point for provider
prerequisites: an unknown provider type, malformed config, or a kind the
provider doesn't serve raises `InvalidInputError` (→ 400), and a connection
that doesn't exist for the user raises `NotFoundError` (→ 404).
`ProviderResolver` wraps it lazily for pipeline runs and chat turns so a run
only constructs the adapters it actually touches.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ProviderConnectionRepository
from app.providers.base import ProviderAdapter, ProviderDescriptor
from app.providers.chat.base import ChatProvider
from app.providers.ollama import OllamaAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.providers.pinecone import PineconeAdapter
from app.retrieval.embedders.base import Embedder
from app.schemas.enums import ProviderKind, ProviderType
from app.services.errors import InvalidInputError, NotFoundError

ADAPTERS: dict[ProviderType, type[ProviderAdapter]] = {
    ProviderType.OPENROUTER: OpenRouterAdapter,
    ProviderType.OLLAMA: OllamaAdapter,
    ProviderType.PINECONE: PineconeAdapter,
}

CONNECTION_REMOVED_DETAIL = (
    "The provider connection this uses was removed. Pick another provider in Settings."
)


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

    def chat(self, connection_id: UUID) -> ChatProvider:
        """Construct a chat provider from a connection id."""
        return self.adapter(connection_id, ProviderKind.CHAT).chat_provider()
