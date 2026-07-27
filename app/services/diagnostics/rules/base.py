"""The `DiagnosticRule` protocol and helpers for building diagnostics.

Every finding a collection surfaces is a `CollectionDiagnostic` produced by a
rule registered in `registry.py`; there are no one-off warning strings. A rule
is a small object declaring a stable `code` + `category` and an `evaluate`
that reads the shared `DiagnosticContext` and returns zero or more diagnostics.
The constructor helpers here keep the built diagnostics consistent (routes,
paired observations, side resources) so rules stay declarative.
"""

from __future__ import annotations

from typing import Literal, Protocol, runtime_checkable

from app.schemas.diagnostics import (
    CollectionDiagnostic,
    DiagnosticAction,
    DiagnosticCategory,
    DiagnosticConfidence,
    DiagnosticLink,
    DiagnosticObservation,
    DiagnosticResource,
    DiagnosticSeverity,
)
from app.services.diagnostics.context import DiagnosticContext

PipelineSide = Literal["ingestion", "retrieval"]


@runtime_checkable
class DiagnosticRule(Protocol):
    """One isolated collection-diagnostics check.

    `code` is a stable identifier (persisted-facing, never renamed casually);
    `category` groups the finding in the UI. `evaluate` must not raise for an
    expected-absent input (it returns `[]`); the service wraps it so an
    unexpected failure degrades to a single informational finding instead of
    sinking the endpoint.
    """

    code: str
    category: DiagnosticCategory

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Return findings for this check, or `[]` when nothing applies."""
        ...


def pipeline_builder_route(side: PipelineSide) -> str:
    """Frontend route to the pipeline builder for a side (edit surface)."""
    return f"/pipelines/{side}"


def pipeline_resource(ctx: DiagnosticContext, side: PipelineSide) -> DiagnosticResource:
    """Build a `DiagnosticResource` naming a collection's pipeline side."""
    resolved = ctx.ingestion if side == "ingestion" else ctx.retrieval
    pipeline = resolved.pipeline if resolved else None
    return DiagnosticResource(
        kind="pipeline",
        id=str(pipeline.id) if pipeline else None,
        name=pipeline.name if pipeline else None,
        pipeline_side=side,
    )


def paired_observation(
    label: str,
    ingestion_value: object,
    retrieval_value: object,
) -> DiagnosticObservation:
    """Build a paired ingestion-vs-retrieval observation, stringifying values."""
    return DiagnosticObservation(
        label=label,
        ingestion=None if ingestion_value is None else str(ingestion_value),
        retrieval=None if retrieval_value is None else str(retrieval_value),
    )


# Keyword-only mirror of CollectionDiagnostic.
def build_diagnostic(  # noqa: PLR0913
    *,
    code: str,
    severity: DiagnosticSeverity,
    confidence: DiagnosticConfidence,
    category: DiagnosticCategory,
    title: str,
    summary: str,
    resources: list[DiagnosticResource] | None = None,
    observations: list[DiagnosticObservation] | None = None,
    action: DiagnosticAction | None = None,
    links: list[DiagnosticLink] | None = None,
) -> CollectionDiagnostic:
    """Construct a well-formed `CollectionDiagnostic` with list defaults."""
    return CollectionDiagnostic(
        code=code,
        severity=severity,
        confidence=confidence,
        category=category,
        title=title,
        summary=summary,
        resources=resources or [],
        observations=observations or [],
        action=action,
        links=links or [],
    )
