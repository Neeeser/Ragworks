"""Unified model catalog across every provider connection of a kind.

One unreachable connection must never break the whole picker: per-connection
failures degrade into `connection_errors` entries while the other
connections' models still return.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ProviderConnectionRepository
from app.providers.openrouter import OpenRouterAdapter
from app.providers.registry import build_adapter, resolve_connection
from app.schemas.enums import ProviderKind
from app.schemas.models import EndpointsListResponse
from app.schemas.providers import (
    CatalogModel,
    ConnectionCatalogError,
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
    del force_refresh  # reserved: adapters TTL-cache their catalogs internally
    catalog: list[CatalogModel] = []
    errors: list[ConnectionCatalogError] = []
    for connection in ProviderConnectionRepository(session).list_for_user(user.id):
        try:
            adapter = build_adapter(connection)
        except InvalidInputError as exc:
            errors.append(_catalog_error(connection, exc))
            continue
        if kind not in adapter.descriptor.kinds:
            continue
        try:
            catalog.extend(adapter.list_models(kind))
        except Exception as exc:  # pylint: disable=broad-exception-caught
            if not (is_external_provider_error(exc) or isinstance(exc, ServiceError)):
                raise
            logger.warning(
                "Model listing failed for connection %s (%s): %s",
                connection.id,
                connection.provider_type,
                exc,
            )
            errors.append(_catalog_error(connection, exc))
    return ModelCatalogResponse(models=catalog, connection_errors=errors)


def _catalog_error(
    connection: models.ProviderConnection, exc: Exception
) -> ConnectionCatalogError:
    """Build the degraded-connection entry for a catalog failure."""
    return ConnectionCatalogError(
        connection_id=connection.id,
        connection_label=connection.label,
        message=str(exc) or "Model listing failed.",
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
