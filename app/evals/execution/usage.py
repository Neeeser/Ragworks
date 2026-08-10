"""Accumulating and pricing an eval run's measured embedding spend.

Tokens come from the runs themselves (ingestion events and retrieval
responses); dollars are added from the embedding models' published per-token
prices, resolved **once** when the accumulator is built so the per-query
commits that follow are pure arithmetic.

The accumulator is committed on every progress beat rather than at the end, so
a run that failed or was cancelled halfway still reports the tokens it spent —
which is exactly what a reader investigating a broken run is looking for.
Every pricing lookup degrades to "no dollars" rather than failing a run.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlmodel import Session

from app.db import models
from app.providers.pricing import catalog_pricing, usd_cost
from app.providers.registry import get_provider, resolve_connection
from app.schemas.enums import ProviderKind
from app.schemas.evals_usage import EvalRunUsage, EvalUsage
from app.schemas.models import ModelPricing
from app.services.pipeline_resolution import (
    ResolvedPipeline,
    resolve_ingest_binding,
    resolve_primary_tool,
)

logger = logging.getLogger(__name__)


@dataclass
class RunUsageAccumulator:
    """One eval run's spend so far, priced by the models that incurred it.

    Holds the two phases apart because they are answerable separately: a run
    reusing an eval collection legitimately spends nothing on ingestion.
    """

    ingestion_pricing: ModelPricing | None = None
    retrieval_pricing: ModelPricing | None = None
    ingestion: EvalUsage = field(default_factory=EvalUsage)
    retrieval: EvalUsage = field(default_factory=EvalUsage)

    def add_ingestion(self, usage: EvalUsage) -> None:
        """Fold one ingestion phase's reported tokens into the total."""
        self.ingestion = self.ingestion.merged_with(usage)

    def add_retrieval(self, usage: EvalUsage) -> None:
        """Fold one evaluated query's reported tokens into the total."""
        self.retrieval = self.retrieval.merged_with(usage)

    def summary(self) -> EvalRunUsage:
        """The run's spend so far, with dollars where prices were published."""
        return EvalRunUsage(
            ingestion=_priced(self.ingestion, self.ingestion_pricing),
            retrieval=_priced(self.retrieval, self.retrieval_pricing),
        )


def build_accumulator(
    session: Session, user: models.User, collection: models.Collection
) -> RunUsageAccumulator:
    """An accumulator priced by the eval collection's own embedding models."""
    return RunUsageAccumulator(
        ingestion_pricing=_embedding_pricing(
            session, user, lambda: resolve_ingest_binding(session, user, collection)
        ),
        retrieval_pricing=_embedding_pricing(
            session, user, lambda: resolve_primary_tool(session, user, collection)
        ),
    )


def _priced(usage: EvalUsage, pricing: ModelPricing | None) -> EvalUsage:
    """Attach dollars to a token count, or leave it as tokens alone."""
    tokens = usage.billable_tokens()
    if tokens is None:
        return usage
    cost = usd_cost(pricing, prompt_tokens=tokens)
    if cost is None:
        return usage
    return usage.model_copy(update={"cost_usd": cost})


def _embedding_pricing(
    session: Session, user: models.User, resolve: Callable[[], ResolvedPipeline]
) -> ModelPricing | None:
    """The published per-token price of a pipeline's embedding model, if any."""
    try:
        resolved = resolve()
        connection_id = resolved.settings.embedding_connection_id
        model_name = resolved.settings.embedding_model
        if connection_id is None or not model_name:
            return None
        connection = resolve_connection(session, user, connection_id)
        adapter = get_provider(connection, ProviderKind.EMBEDDING)
        return catalog_pricing(adapter, ProviderKind.EMBEDDING, model_name)
    except Exception:  # a run's spend is reported in tokens even when unpriceable
        logger.debug("Eval run embedding pricing unavailable", exc_info=True)
        return None
