"""Category-C rules: live vector-store probes for the retrieval index.

Unlike the pure-config rules, these contact the store (via the budget-bounded
`VectorStoreProber`) to check that the index retrieval reads actually exists
and holds vectors. Any probe failure degrades to a single informational
"index status unavailable" finding -- the endpoint always returns.
"""

from __future__ import annotations

from app.pipelines.settings import IndexTarget
from app.schemas.diagnostics import (
    CollectionDiagnostic,
    DiagnosticCategory,
    DiagnosticResource,
)
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.prober import ProbeUnavailable
from app.services.diagnostics.rules.base import build_diagnostic


class IndexProbeRule:
    """Probe every retrieval index target: missing, empty, or reachable.

    Emits `missing_index` (error) when an index retrieval reads does not exist,
    `empty_index` (warning) when it exists but holds no vectors, and
    `index_status_unavailable` (info) when the store cannot be reached.

    Both index findings drop to `info` until the collection has an ingestion
    run: an index nothing has written to yet is the expected state of a new
    collection (the BM25 sibling is created on first ingest), and reporting it
    as an error opens every fresh workspace on a failure it cannot act on.
    """

    code = "index_probe"
    category: DiagnosticCategory = "index_config"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Probe each retrieval index target and report existence/count."""
        retrieval = ctx.retrieval_settings
        if retrieval is None:
            return []
        diagnostics: list[CollectionDiagnostic] = []
        for target in retrieval.index_targets:
            diagnostics.extend(self._probe_target(ctx, target, retrieval.namespace))
        return diagnostics

    def _probe_target(
        self,
        ctx: DiagnosticContext,
        target: IndexTarget,
        namespace: str | None,
    ) -> list[CollectionDiagnostic]:
        """Probe one index target, degrading to an info finding on failure."""
        resource = DiagnosticResource(
            kind="index", name=target.index_name, pipeline_side="retrieval"
        )
        try:
            stats = ctx.prober.stats(target.backend, target.index_name, namespace)
        except ProbeUnavailable:
            return [
                build_diagnostic(
                    code="index_status_unavailable",
                    severity="info",
                    confidence="heuristic",
                    category=self.category,
                    title="Index status unavailable",
                    summary=(
                        f"Could not reach the vector store to check index "
                        f"'{target.index_name}'. This is a transient check "
                        "failure, not a confirmed problem; reload to retry."
                    ),
                    resources=[resource],
                )
            ]
        if not stats.exists:
            return [self._missing_index(ctx, target, resource)]
        if stats.count == 0:
            return [self._empty_index(ctx, target, resource)]
        return []

    def _missing_index(
        self,
        ctx: DiagnosticContext,
        target: IndexTarget,
        resource: DiagnosticResource,
    ) -> CollectionDiagnostic:
        """An index retrieval reads that the store does not hold."""
        if not ctx.has_ingestion_run:
            return build_diagnostic(
                code="missing_index",
                severity="info",
                confidence="confirmed",
                category=self.category,
                title="Retrieval index not created yet",
                summary=(
                    f"The index '{target.index_name}' that retrieval queries is "
                    "created by the first ingestion run. This collection has not "
                    "ingested any documents yet."
                ),
                resources=[resource],
            )
        return build_diagnostic(
            code="missing_index",
            severity="error",
            confidence="confirmed",
            category=self.category,
            title="Retrieval index does not exist",
            summary=(
                f"The index '{target.index_name}' that retrieval queries does not "
                "exist in the store yet. Ingest documents to create it; searches "
                "return nothing until then."
            ),
            resources=[resource],
        )

    def _empty_index(
        self,
        ctx: DiagnosticContext,
        target: IndexTarget,
        resource: DiagnosticResource,
    ) -> CollectionDiagnostic:
        """An index that exists but holds no vectors."""
        if not ctx.has_ingestion_run:
            return build_diagnostic(
                code="empty_index",
                severity="info",
                confidence="confirmed",
                category=self.category,
                title="Retrieval index holds no vectors yet",
                summary=(
                    f"The index '{target.index_name}' holds no vectors. This "
                    "collection has not ingested any documents yet; searches "
                    "return nothing until it does."
                ),
                resources=[resource],
            )
        return build_diagnostic(
            code="empty_index",
            severity="warning",
            confidence="confirmed",
            category=self.category,
            title="Retrieval index is empty",
            summary=(
                f"The index '{target.index_name}' exists but holds no vectors, so "
                "searches return nothing. Ingest documents into this collection."
            ),
            resources=[resource],
        )
