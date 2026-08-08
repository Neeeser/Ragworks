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
from functools import partial
from uuid import UUID, uuid4

from sqlmodel import Session

from app.cache import CachePolicy, ValueCache
from app.clients.anthropic import close_anthropic_clients, invalidate_anthropic_client
from app.clients.cohere import close_cohere_clients, invalidate_cohere_client
from app.clients.ollama.client import (
    close_ollama_clients,
    invalidate_ollama_client,
)
from app.clients.openai_compat import (
    close_openai_compat_clients,
    invalidate_openai_compat_client,
)
from app.clients.openrouter.client import (
    close_openrouter_clients,
    invalidate_openrouter_client,
)
from app.clients.tei import close_tei_clients, invalidate_tei_client
from app.db import models
from app.db.repositories import ProviderConnectionRepository
from app.providers.anthropic import AnthropicAdapter
from app.providers.base import ProviderAdapter, ProviderDescriptor
from app.providers.batched import BatchedEmbedder
from app.providers.chat.base import ChatProvider
from app.providers.cohere import CohereAdapter
from app.providers.custom import CustomAdapter
from app.providers.ollama import OllamaAdapter
from app.providers.openai import OpenAIAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.providers.pinecone import PineconeAdapter
from app.providers.tei import TEIAdapter
from app.providers.throttle import RetryPolicy, resolve_retry_policy
from app.providers.throttled import ThrottledEmbedder, ThrottledReranker
from app.retrieval.embedders.base import Embedder
from app.retrieval.rerankers.base import Reranker
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.provider_configs import (
    AnthropicConnectionConfig,
    CohereConnectionConfig,
    OllamaConnectionConfig,
    OpenRouterConnectionConfig,
    TEIConnectionConfig,
)
from app.services.errors import InvalidInputError, NotFoundError

ADAPTERS: dict[ProviderType, type[ProviderAdapter]] = {
    ProviderType.OPENROUTER: OpenRouterAdapter,
    ProviderType.OPENAI: OpenAIAdapter,
    ProviderType.ANTHROPIC: AnthropicAdapter,
    ProviderType.OLLAMA: OllamaAdapter,
    ProviderType.COHERE: CohereAdapter,
    ProviderType.TEI: TEIAdapter,
    ProviderType.CUSTOM: CustomAdapter,
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

#: Widths resolved for the *validation* path, retaining an unresolvable
#: (`None`) answer — see `resolve_embedding_width` for why that matters.
_resolved_dimension_cache = ValueCache[tuple[UUID, str], int | None](
    CachePolicy(
        fresh_seconds=300,
        max_stale_seconds=3600,
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


def _invalidate_cohere(config: dict[str, object]) -> None:
    parsed = CohereConnectionConfig.model_validate(config)
    invalidate_cohere_client(parsed.api_key)


def _invalidate_tei(config: dict[str, object]) -> None:
    parsed = TEIConnectionConfig.model_validate(config)
    invalidate_tei_client(parsed.base_url, parsed.api_key)


def _invalidate_anthropic(config: dict[str, object]) -> None:
    parsed = AnthropicConnectionConfig.model_validate(config)
    invalidate_anthropic_client(parsed.api_key, parsed.base_url)


def _invalidate_openai_compat(provider_type: ProviderType, config: dict[str, object]) -> None:
    """Drop the shared client keyed by an OpenAI-compatible endpoint identity.

    The key is the transport identity, not the credential, so it is rebuilt
    from the adapter rather than reconstructed here — a mismatch would leave
    the old pool serving requests with a credential the user just changed.
    """
    connection = models.ProviderConnection(
        user_id=uuid4(), provider_type=provider_type.value, label="", config=config
    )
    adapter = ADAPTERS[provider_type](connection)
    transport_config = getattr(adapter, "transport_config", None)
    if transport_config is not None:
        invalidate_openai_compat_client(transport_config())


_CACHE_INVALIDATORS: dict[ProviderType, Callable[[dict[str, object]], None]] = {
    ProviderType.OPENROUTER: _invalidate_openrouter,
    ProviderType.OLLAMA: _invalidate_ollama,
    ProviderType.COHERE: _invalidate_cohere,
    ProviderType.TEI: _invalidate_tei,
    ProviderType.ANTHROPIC: _invalidate_anthropic,
    ProviderType.OPENAI: partial(_invalidate_openai_compat, ProviderType.OPENAI),
    ProviderType.CUSTOM: partial(_invalidate_openai_compat, ProviderType.CUSTOM),
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
        raise InvalidInputError(f"Unknown provider type '{connection.provider_type}'.") from exc
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


def resolve_embedding_width(
    adapter: ProviderAdapter,
    connection_id: UUID,
    model_id: str,
) -> int | None:
    """Return a model's vector width: published if the catalog has it, else measured.

    Catalog first — it is free and exact where a provider publishes a width.
    Many publish none (OpenRouter publishes no dimension for *any* embedding
    model), so a catalog-only lookup answers `None` for the provider this app
    is most used with, and every check built on the width goes quiet on the
    pipelines that need it most. The probe (`embedding_dimension`, which
    embeds one short string) is what closes that gap.

    **The cache is what makes probing safe here**, and this wrapper is the
    only reason the probe may sit on the validation path at all: validation
    re-resolves on a debounce while the pipeline editor is open, so an
    *uncached* probe would fire a live embedding call per keystroke. The
    combined answer is retained `None` included — `cached_embedding_dimension`
    deliberately drops a `None`, so a model whose probe fails would otherwise
    be re-probed on every keystroke, which is exactly that runaway. Net cost:
    one probe ever for a resolvable model, one per freshness window for an
    unresolvable one.
    """

    def resolve() -> int | None:
        published = adapter.catalog_embedding_dimension(model_id)
        if published is not None:
            return published
        # Shares the API route's probe cache, so a width measured for the
        # model picker is not measured again here.
        return cached_embedding_dimension(
            connection_id,
            model_id,
            lambda: adapter.embedding_dimension(model_id),
        )

    return _resolved_dimension_cache.get((connection_id, model_id), resolve).value


def invalidate_embedding_dimensions(connection_id: UUID) -> int:
    """Drop dimension values owned by one changed or deleted connection."""
    dropped = _dimension_cache.invalidate_matching(lambda key: key[0] == connection_id)
    return dropped + _resolved_dimension_cache.invalidate_matching(
        lambda key: key[0] == connection_id
    )


def invalidate_connection_caches(connection: models.ProviderConnection) -> None:
    """Close resources derived from a connection's stored configuration."""
    provider_type = ProviderType(connection.provider_type)
    invalidator = _CACHE_INVALIDATORS.get(provider_type)
    if invalidator is not None:
        invalidator(connection.config)


def close_provider_clients() -> None:
    """Close all provider-owned caches and resources during application shutdown."""
    _dimension_cache.close()
    _resolved_dimension_cache.close()
    close_openrouter_clients()
    close_ollama_clients()
    close_cohere_clients()
    close_tei_clients()
    close_anthropic_clients()
    close_openai_compat_clients()


class ProviderResolver:
    """Lazy per-run adapter factory bound to one user and session.

    Replaces the raw `OpenRouterClient` on `PipelineRunContext`: adapters are
    constructed on first use and cached for the run, so a run only pays for
    the connections its nodes actually reference.
    """

    def __init__(self, user: models.User, session: Session) -> None:
        """Bind the resolver to the run's user and session.

        Reads `providers.max_retry_attempts` once, here — every embedder,
        reranker, and the LLM engine this resolver hands out for the run
        shares the one resolved `RetryPolicy` rather than each reading app
        config for itself.
        """
        self._user = user
        self._session = session
        self._adapters: dict[tuple[UUID, ProviderKind], ProviderAdapter] = {}
        self.retry_policy: RetryPolicy = resolve_retry_policy()

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
        """Construct an embedder, batched and throttled to the connection's budget.

        Batching wraps the throttle rather than the other way round, so each
        sub-batch is a full request: its own slot, its own pace, its own retry.
        """
        adapter = self.adapter(connection_id, ProviderKind.EMBEDDING)
        rpm, window = adapter.request_pace(ProviderKind.EMBEDDING)
        throttled = ThrottledEmbedder(
            adapter.embedder(model_name, dimensions=dimensions),
            connection_id,
            limit=adapter.request_concurrency(),
            rpm=rpm,
            window=window,
            retry_policy=self.retry_policy,
        )
        batch_size = adapter.embedding_batch_size()
        if batch_size is None:
            return throttled
        return BatchedEmbedder(throttled, batch_size)

    def embedding_input_limit(self, connection_id: UUID, model_name: str) -> int | None:
        """Return the provider-published embedding input limit when known."""
        return self.adapter(connection_id, ProviderKind.EMBEDDING).embedding_input_limit(model_name)

    def input_modalities(
        self, connection_id: UUID, model_name: str, kind: ProviderKind
    ) -> frozenset[str]:
        """Return the input modalities a connection's catalog publishes."""
        return self.adapter(connection_id, kind).catalog_input_modalities(model_name, kind)

    def chat(self, connection_id: UUID) -> ChatProvider:
        """Construct a chat provider from a connection id."""
        return self.adapter(connection_id, ProviderKind.CHAT).chat_provider()

    def request_concurrency(self, connection_id: UUID) -> int:
        """Concurrent model calls allowed through a connection (see throttle)."""
        return self.adapter(connection_id, ProviderKind.CHAT).request_concurrency()

    def request_rpm(self, connection_id: UUID) -> int | None:
        """Shared requests-per-minute pace for a connection, or None."""
        return self.adapter(connection_id, ProviderKind.CHAT).request_rpm()

    def reranker(self, connection_id: UUID, model_name: str) -> Reranker:
        """Construct a reranker, throttled to the connection's budget."""
        adapter = self.adapter(connection_id, ProviderKind.RERANKING)
        rpm, window = adapter.request_pace(ProviderKind.RERANKING)
        return ThrottledReranker(
            adapter.reranker(model_name),
            connection_id,
            limit=adapter.request_concurrency(),
            rpm=rpm,
            window=window,
            retry_policy=self.retry_policy,
        )
