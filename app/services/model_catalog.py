"""Unified model catalog across every provider connection of a kind.

One unreachable connection must never break the whole picker: per-connection
failures degrade into `connection_errors` entries while the other
connections' models still return.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ProviderConnectionRepository
from app.providers.base import CatalogResult, ProviderAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.providers.registry import (
    build_adapter,
    cached_embedding_dimension,
    resolve_connection,
)
from app.schemas.enums import ProviderKind
from app.schemas.models import EndpointsListResponse
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConnectionCatalogError,
    EmbeddingDimensionResponse,
    ModelCatalogResponse,
)
from app.services.errors import InvalidInputError, ServiceError, is_external_provider_error

logger = logging.getLogger(__name__)


def list_models_for_user(
    session: Session,
    user: models.User,
    kind: ProviderKind,
    *,
    force_refresh: bool = False,
) -> ModelCatalogResponse:
    """List models of one kind across all the user's capable connections."""
    catalog: list[CatalogModel] = []
    errors: list[ConnectionCatalogError] = []
    jobs: list[tuple[models.ProviderConnection, ProviderAdapter]] = []
    for connection in ProviderConnectionRepository(session).list_for_user(user.id):
        try:
            adapter = build_adapter(connection)
        except InvalidInputError as exc:
            errors.append(_catalog_error(connection, exc))
            continue
        if kind not in adapter.descriptor.kinds:
            continue
        jobs.append((connection, adapter))

    results = _load_catalogs(jobs, kind, force_refresh=force_refresh)
    metadata: list[CatalogMetadata] = []
    for connection, result_or_error in zip(
        (connection for connection, _adapter in jobs), results, strict=True
    ):
        if isinstance(result_or_error, Exception):
            failure = result_or_error
            if not (
                is_external_provider_error(failure)
                or isinstance(failure, ServiceError)
            ):
                raise failure
            logger.warning(
                "Model listing failed for connection %s (%s): %s",
                connection.id,
                connection.provider_type,
                failure,
            )
            errors.append(_catalog_error(connection, failure))
            continue
        catalog.extend(result_or_error.models)
        metadata.append(result_or_error.meta)
    return ModelCatalogResponse(
        models=catalog,
        connection_errors=errors,
        meta=_aggregate_metadata(metadata),
    )


def _load_catalogs(
    jobs: list[tuple[models.ProviderConnection, ProviderAdapter]],
    kind: ProviderKind,
    *,
    force_refresh: bool,
) -> list[CatalogResult | Exception]:
    """Load capable connections, fanning an explicit refresh out in parallel."""
    if not force_refresh or len(jobs) < 2:
        return [_load_one(adapter, kind, force_refresh) for _connection, adapter in jobs]
    with ThreadPoolExecutor(
        max_workers=min(8, len(jobs)), thread_name_prefix="model-catalog-refresh"
    ) as executor:
        futures = [
            executor.submit(_load_one, adapter, kind, True)
            for _connection, adapter in jobs
        ]
        return [future.result() for future in futures]


def _load_one(
    adapter: ProviderAdapter, kind: ProviderKind, force_refresh: bool
) -> CatalogResult | Exception:
    try:
        return adapter.list_models(kind, force_refresh=force_refresh)
    except Exception as exc:  # pylint: disable=broad-exception-caught
        return exc


def _aggregate_metadata(metadata: list[CatalogMetadata]) -> CatalogMetadata:
    warnings = list(
        dict.fromkeys(meta.warning for meta in metadata if meta.warning is not None)
    )
    return CatalogMetadata(
        freshness=(
            "stale" if any(meta.freshness == "stale" for meta in metadata) else "fresh"
        ),
        age_seconds=max((meta.age_seconds for meta in metadata), default=0),
        refreshing=any(meta.refreshing for meta in metadata),
        warning="; ".join(warnings) or None,
    )


def _catalog_error(
    connection: models.ProviderConnection, exc: Exception
) -> ConnectionCatalogError:
    """Build the degraded-connection entry for a catalog failure."""
    return ConnectionCatalogError(
        connection_id=connection.id,
        connection_label=connection.label,
        message=str(exc) or "Model listing failed.",
    )


def resolve_embedding_dimension(
    session: Session,
    user: models.User,
    connection_id: UUID,
    model_id: str,
) -> EmbeddingDimensionResponse:
    """Resolve one model's dimension without conflating separate connections."""
    if not model_id.strip():
        raise InvalidInputError("Embedding model id must be provided.")
    connection = resolve_connection(session, user, connection_id)
    adapter = build_adapter(connection)
    adapter.require_kind(ProviderKind.EMBEDDING)
    dimension = cached_embedding_dimension(
        connection.id,
        model_id,
        lambda: adapter.embedding_dimension(model_id),
    )
    return EmbeddingDimensionResponse(
        connection_id=connection.id,
        model_id=model_id,
        dimension=dimension,
    )


def list_openrouter_model_endpoints(
    session: Session,
    user: models.User,
    connection_id: UUID,
    author: str,
    slug: str,
) -> EndpointsListResponse:
    """Return OpenRouter's per-provider endpoint directory for a model.

    Only meaningful for OpenRouter connections — the endpoint directory is
    OpenRouter's provider-routing surface, so other provider types are a 400.
    """
    connection = resolve_connection(session, user, connection_id)
    adapter = build_adapter(connection)
    if not isinstance(adapter, OpenRouterAdapter):
        raise InvalidInputError(
            "Model endpoint directories are only available for OpenRouter connections."
        )
    return adapter.list_model_endpoints(author, slug)
