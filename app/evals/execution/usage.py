"""Pricing an eval run's measured embedding spend.

Tokens come from the runs themselves (ingestion events and retrieval
responses); dollars are added here, and only where the embedding model's
provider publishes per-token pricing. Every lookup degrades to "no dollars"
rather than failing a run that has already finished its work.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from sqlmodel import Session

from app.db import models
from app.providers.pricing import catalog_pricing, usd_cost
from app.providers.registry import get_provider, resolve_connection
from app.schemas.enums import ProviderKind
from app.schemas.evals_usage import EvalUsage
from app.services.pipeline_resolution import (
    ResolvedPipeline,
    resolve_ingest_binding,
    resolve_primary_tool,
)

logger = logging.getLogger(__name__)


def price_ingestion(
    session: Session, user: models.User, collection: models.Collection, usage: EvalUsage
) -> EvalUsage:
    """Add dollars to the ingestion spend, priced by the ingest pipeline's embedder."""
    return _priced(session, user, usage, lambda: resolve_ingest_binding(session, user, collection))


def price_retrieval(
    session: Session, user: models.User, collection: models.Collection, usage: EvalUsage
) -> EvalUsage:
    """Add dollars to the query spend, priced by the retrieval pipeline's embedder."""
    return _priced(session, user, usage, lambda: resolve_primary_tool(session, user, collection))


def _priced(
    session: Session,
    user: models.User,
    usage: EvalUsage,
    resolve: Callable[[], ResolvedPipeline],
) -> EvalUsage:
    """Price `usage` with the embedding model the resolved pipeline uses."""
    tokens = usage.billable_tokens()
    if tokens is None:
        return usage
    try:
        resolved = resolve()
        connection_id = resolved.settings.embedding_connection_id
        model_name = resolved.settings.embedding_model
        if connection_id is None or not model_name:
            return usage
        connection = resolve_connection(session, user, connection_id)
        adapter = get_provider(connection, ProviderKind.EMBEDDING)
        pricing = catalog_pricing(adapter, ProviderKind.EMBEDDING, model_name)
    except Exception:  # a run's spend is reported in tokens even when unpriceable
        logger.debug("Eval run embedding pricing unavailable", exc_info=True)
        return usage
    cost = usd_cost(pricing, prompt_tokens=tokens)
    if cost is None:
        return usage
    return usage.model_copy(update={"cost_usd": cost})
