"""Rules for nodes pointed at a backend that cannot run them.

A binding chooses which index a pipeline targets, and an index carries its
backend — so a pipeline valid as authored can become invalid for one
collection. These rules name the offending nodes, because "wrong backend" on
its own leaves the user guessing which of a dozen nodes to change.
"""

from __future__ import annotations

from app.pipelines.backend_support import incompatible_nodes
from app.pipelines.registry import default_registry
from app.schemas.diagnostics import (
    CollectionDiagnostic,
    DiagnosticAction,
    DiagnosticCategory,
    DiagnosticObservation,
)
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.rules.base import (
    PipelineSide,
    build_diagnostic,
    pipeline_builder_route,
    pipeline_resource,
)
from app.services.pipeline_resolution import ResolvedPipeline


class BackendCapabilityRule:
    """A node requires capabilities its selected index's backend lacks (error)."""

    code = "backend_capability_unsupported"
    category: DiagnosticCategory = "backend_storage"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag nodes whose resolved backend cannot serve them."""
        sides: tuple[tuple[PipelineSide, ResolvedPipeline | None], ...] = (
            ("ingestion", ctx.ingestion),
            ("retrieval", ctx.retrieval),
        )
        findings: list[CollectionDiagnostic] = []
        for side, resolved in sides:
            if resolved is None:
                continue
            diagnostic = self._for_side(ctx, side, resolved)
            if diagnostic is not None:
                findings.append(diagnostic)
        return findings

    def _for_side(
        self,
        ctx: DiagnosticContext,
        side: PipelineSide,
        resolved: ResolvedPipeline,
    ) -> CollectionDiagnostic | None:
        """Build one side's finding, or None when every node fits."""
        incompatible = incompatible_nodes(resolved.static_definition, default_registry())
        if not incompatible:
            return None
        backends = sorted({finding.backend.value for finding in incompatible})
        return build_diagnostic(
            code=self.code,
            severity="error",
            confidence="confirmed",
            category=self.category,
            title="Nodes are not supported by the selected index's backend",
            summary=(
                f"This collection's {side} pipeline points at an index on "
                f"{', '.join(backends)}, which cannot run every node in the "
                "graph. Choose an index on a supported backend, or replace "
                "the nodes listed below."
            ),
            resources=[pipeline_resource(ctx, side)],
            observations=[
                DiagnosticObservation(label=finding.node_id, value=finding.message)
                for finding in incompatible
            ],
            action=DiagnosticAction(
                label=f"Edit {side} pipeline",
                route=pipeline_builder_route(side),
            ),
        )
