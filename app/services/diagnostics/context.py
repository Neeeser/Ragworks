"""The `DiagnosticContext` every rule reads, built once per request.

The context resolves both sides of a collection (ingestion + retrieval)
*read-only* -- diagnostics is served from a GET the Overview widget fires on
every visit, so it must never scaffold or bind a default pipeline the way the
ingestion/retrieval paths do. An unbound or unresolvable side is recorded as a
resolution-failure string, not raised, so it becomes a diagnostic rather than
a 400.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session

from app.db import models
from app.db.repositories.pipeline import PipelineRunRepository
from app.pipelines.settings import PipelineSettings
from app.pipelines.validation import PipelineValidationResult
from app.services.diagnostics.prober import VectorStoreProber
from app.services.pipeline_resolution import (
    PipelineResolutionError,
    ResolvedPipeline,
    resolve_ingest_binding,
    resolve_primary_tool,
)
from app.services.pipeline_validation import validate_pipeline_definition

_RECENT_FAILURE_LIMIT = 5


@dataclass
class DiagnosticContext:
    """Everything the diagnostics rules read, resolved once per request.

    A side is `None` when its pipeline could not be resolved read-only; the
    matching `*_error` then holds why. Rules that compare the two sides must
    tolerate either being absent.
    """

    collection: models.Collection
    user: models.User
    session: Session
    prober: VectorStoreProber
    ingestion: ResolvedPipeline | None = None
    retrieval: ResolvedPipeline | None = None
    ingestion_error: str | None = None
    retrieval_error: str | None = None
    ingestion_validation: PipelineValidationResult | None = None
    retrieval_validation: PipelineValidationResult | None = None
    recent_ingestion_failures: list[models.PipelineRun] = field(default_factory=list)
    recent_retrieval_failures: list[models.PipelineRun] = field(default_factory=list)

    @property
    def ingestion_settings(self) -> PipelineSettings | None:
        """Resolved ingestion settings, or None when the side didn't resolve."""
        return self.ingestion.settings if self.ingestion else None

    @property
    def retrieval_settings(self) -> PipelineSettings | None:
        """Resolved retrieval settings, or None when the side didn't resolve."""
        return self.retrieval.settings if self.retrieval else None

    @property
    def both_sides_resolved(self) -> bool:
        """True when both pipelines resolved -- required for comparison rules."""
        return self.ingestion is not None and self.retrieval is not None


def build_context(
    session: Session,
    user: models.User,
    collection: models.Collection,
) -> DiagnosticContext:
    """Resolve both pipeline sides read-only and gather run history + prober."""
    ctx = DiagnosticContext(
        collection=collection,
        user=user,
        session=session,
        prober=VectorStoreProber(user, session),
    )
    try:
        ctx.ingestion = resolve_ingest_binding(session, user, collection, scaffold=False)
        ctx.ingestion_validation = validate_pipeline_definition(
            session, user, ctx.ingestion.definition
        )
    except PipelineResolutionError as exc:
        ctx.ingestion_error = str(exc)
    try:
        ctx.retrieval = resolve_primary_tool(session, user, collection, scaffold=False)
        ctx.retrieval_validation = validate_pipeline_definition(
            session, user, ctx.retrieval.definition
        )
    except PipelineResolutionError as exc:
        ctx.retrieval_error = str(exc)

    runs = PipelineRunRepository(session)
    ctx.recent_ingestion_failures = runs.list_recent_for_collection(
        collection.id,
        models.BindingRole.INGEST,
        status=models.PipelineRunStatus.FAILED,
        limit=_RECENT_FAILURE_LIMIT,
    )
    ctx.recent_retrieval_failures = runs.list_recent_for_collection(
        collection.id,
        models.BindingRole.TOOL,
        status=models.PipelineRunStatus.FAILED,
        limit=_RECENT_FAILURE_LIMIT,
    )
    return ctx
