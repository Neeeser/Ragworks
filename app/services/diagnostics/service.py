"""`CollectionDiagnosticsService`: build context, run rules, aggregate, cache.

The service iterates the registry over a per-request `DiagnosticContext`,
wraps each rule so a single check failing degrades to one informational
finding instead of sinking the endpoint, and derives the response counts and
`consistent` flag. Results are cached through the shared cache layer keyed on a
signature that busts on any config/binding/ingestion change; a short TTL bounds
the freshness of the live probe findings.
"""

from __future__ import annotations

import logging

from sqlmodel import Session

from app.cache import CachePolicy, ValueCache
from app.db import models
from app.db.repositories.pipeline import PipelineRepository, PipelineRunRepository
from app.schemas.diagnostics import (
    CollectionDiagnostic,
    CollectionDiagnosticsResponse,
)
from app.services.diagnostics.context import DiagnosticContext, build_context
from app.services.diagnostics.rules.base import DiagnosticRule, build_diagnostic
from app.services.diagnostics.rules.registry import DIAGNOSTIC_RULES
from app.utils.time import utc_now

logger = logging.getLogger(__name__)

# Categories whose `error` findings make a collection "inconsistent". Run
# failures and node-config issues are deliberately excluded -- a recent failed
# run does not mean the current configuration is inconsistent.
_CONSISTENCY_CATEGORIES = frozenset(
    {"embedding", "index_config", "backend_storage", "pipeline_compatibility"}
)

# Short freshness with a stale-serve window: the signature busts the entry on
# any config/binding/ingestion change, so the TTL only bounds the live probe
# findings (which the signature cannot capture).
_POLICY = CachePolicy(
    fresh_seconds=15.0,
    max_stale_seconds=60.0,
    failure_retry_seconds=5.0,
    max_entries=256,
)


class CollectionDiagnosticsService:
    """Runs collection diagnostics for one user/session."""

    _cache: ValueCache[str, CollectionDiagnosticsResponse] = ValueCache(_POLICY)

    def __init__(self, session: Session) -> None:
        """Bind the service to the request session."""
        self.session = session

    def run(
        self,
        user: models.User,
        collection: models.Collection,
        *,
        rules: list[DiagnosticRule] | None = None,
    ) -> CollectionDiagnosticsResponse:
        """Return diagnostics for a collection, served through the cache."""
        signature = self._signature(collection)
        return self._cache.get(
            signature,
            lambda: self._evaluate(user, collection, rules or DIAGNOSTIC_RULES),
        ).value

    def _evaluate(
        self,
        user: models.User,
        collection: models.Collection,
        rules: list[DiagnosticRule],
    ) -> CollectionDiagnosticsResponse:
        """Build the context, run every rule, and aggregate the response."""
        ctx = build_context(self.session, user, collection)
        diagnostics: list[CollectionDiagnostic] = []
        for rule in rules:
            diagnostics.extend(self._run_rule(rule, ctx))
        return self._aggregate(collection, diagnostics)

    @staticmethod
    def _run_rule(rule: DiagnosticRule, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Evaluate one rule, degrading an unexpected failure to an info finding."""
        try:
            return rule.evaluate(ctx)
        except Exception:  # pylint: disable=broad-exception-caught
            # A rule must never sink the endpoint; a bug in one check becomes a
            # single informational finding, and the rest still run.
            logger.warning("Diagnostic rule %s failed", rule.code, exc_info=True)
            return [
                build_diagnostic(
                    code=f"{rule.code}_unavailable",
                    severity="info",
                    confidence="heuristic",
                    category=rule.category,
                    title="Diagnostic check unavailable",
                    summary=(
                        "This check could not run and was skipped. It is not a "
                        "confirmed problem; reload to retry."
                    ),
                )
            ]

    @staticmethod
    def _aggregate(
        collection: models.Collection,
        diagnostics: list[CollectionDiagnostic],
    ) -> CollectionDiagnosticsResponse:
        """Compute counts and the derived `consistent` flag."""
        error_count = sum(1 for d in diagnostics if d.severity == "error")
        warning_count = sum(1 for d in diagnostics if d.severity == "warning")
        consistent = not any(
            d.severity == "error" and d.category in _CONSISTENCY_CATEGORIES
            for d in diagnostics
        )
        return CollectionDiagnosticsResponse(
            collection_id=collection.id,
            generated_at=utc_now(),
            error_count=error_count,
            warning_count=warning_count,
            consistent=consistent,
            diagnostics=diagnostics,
        )

    def _signature(self, collection: models.Collection) -> str:
        """Cheap cache key that busts on config/binding/ingestion changes."""
        pipelines = PipelineRepository(self.session)
        runs = PipelineRunRepository(self.session)
        parts = [str(collection.id)]
        for pipeline_id in (collection.ingestion_pipeline_id, collection.retrieval_pipeline_id):
            if pipeline_id is None:
                parts.append("none")
                continue
            pipeline = pipelines.get(pipeline_id)
            parts.append(f"{pipeline_id}:{pipeline.current_version if pipeline else 0}")
        latest = runs.list_recent_for_collection(
            collection.id, models.BindingRole.INGEST, limit=1
        )
        parts.append(str(latest[0].id) if latest else "no-ingest")
        return "|".join(parts)
