"""Run-history rules: recent FAILED ingestion/retrieval runs.

These read persisted run history (no live probe) and link each failed run to
its trace so a user can see what broke. Advisory only -- a failed run in the
recent history does not mean the collection is currently broken, so these are
warnings and are deliberately excluded from the `consistent` flag.
"""

from __future__ import annotations

from app.db import models
from app.schemas.diagnostics import (
    CollectionDiagnostic,
    DiagnosticCategory,
    DiagnosticLink,
)
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.rules.base import build_diagnostic


def _run_links(runs: list[models.PipelineRun]) -> list[DiagnosticLink]:
    """Build a trace link per failed run (failures link to the run trace)."""
    return [
        DiagnosticLink(
            label=f"Run {str(run.id)[:8]}",
            route=f"/traces/runs/{run.id}",
            kind="trace",
        )
        for run in runs
    ]


class RecentIngestionFailuresRule:
    """FAILED ingestion runs whose document is still not indexed (warning).

    `ctx.recent_ingestion_failures` is pre-scoped by `build_context` to runs
    that are still true (see its docstring): each one names a document that
    has not since been retried successfully, so this rule self-clears once
    every affected document is READY, rather than warning about a healthy
    collection forever.
    """

    code = "recent_ingestion_failures"
    category: DiagnosticCategory = "run_failures"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Summarize still-unresolved failed ingestion runs, with trace links."""
        failures = ctx.recent_ingestion_failures
        if not failures:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="warning",
                confidence="confirmed",
                category=self.category,
                title=f"{len(failures)} document(s) failed to index",
                summary=(
                    "One or more documents failed their last ingestion attempt "
                    "and have not been indexed since. Open a run trace to see "
                    "which node broke and why."
                ),
                links=_run_links(failures),
            )
        ]


class RecentRetrievalFailuresRule:
    """Recent FAILED retrieval runs for the collection (warning).

    Deliberately not scoped to "still true" the way ingestion failures are: a
    failed search leaves no persisted resource (no document, no index row)
    that can be re-checked for resolution, so there is nothing to join
    against to tell a stale failure from a current one. Self-clearing this
    would need an unrelated time/recency redesign, not a resource check.
    """

    code = "recent_retrieval_failures"
    category: DiagnosticCategory = "run_failures"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Summarize recent failed retrieval runs with links to their traces."""
        failures = ctx.recent_retrieval_failures
        if not failures:
            return []
        return [
            build_diagnostic(
                code=self.code,
                severity="warning",
                confidence="confirmed",
                category=self.category,
                title=f"{len(failures)} recent search failure(s)",
                summary=(
                    "One or more recent searches failed. Open a run trace to see "
                    "which node broke and why."
                ),
                links=_run_links(failures),
            )
        ]
