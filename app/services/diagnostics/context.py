"""The `DiagnosticContext` every rule reads, built once per request.

The context resolves both sides of a collection (ingestion + retrieval) and
records an unbound or unresolvable side as a resolution-failure string rather
than raising, so it becomes a diagnostic rather than a 400 on a GET the
Overview widget fires on every visit.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session

from app.db import models
from app.db.repositories.document import DocumentRepository
from app.db.repositories.pipeline import PipelineRunRepository
from app.pipelines.settings import PipelineSettings
from app.pipelines.validation import PipelineValidationResult
from app.services.diagnostics.prober import VectorStoreProber
from app.services.pipeline_resolution import (
    PipelineResolutionError,
    ResolvedPipeline,
    resolve_ingest_binding,
    resolve_primary_tool,
    resolve_tool_bindings,
)
from app.services.pipeline_validation import validate_pipeline_definition

_RECENT_FAILURE_LIMIT = 5


@dataclass
class DiagnosticContext:
    """Everything the diagnostics rules read, resolved once per request.

    A side is `None` when its pipeline could not be resolved read-only; the
    matching `*_error` then holds why. Rules that compare the two sides must
    tolerate either being absent.

    `has_ingestion_run` is the "has anything ever been ingested here?" signal:
    an ingest-triggered `PipelineRun` row of any status. It is a run row rather
    than a document count because a `Document` exists from upload, before any
    pipeline touches it -- a rule keying on documents would call a collection
    ingested while its indexes are still uncreated.
    """

    collection: models.Collection
    user: models.User
    session: Session
    prober: VectorStoreProber
    ingestion: ResolvedPipeline | None = None
    retrieval: ResolvedPipeline | None = None
    #: Every *enabled* tool binding, resolved read-only -- the live view of
    #: what a chat turn would actually expose (chat only loads enabled
    #: bindings). Used by `DuplicateToolNameRule`; a binding that fails to
    #: resolve degrades the whole list to `[]` rather than raising, matching
    #: every other field on this context.
    tool_bindings: list[ResolvedPipeline] = field(default_factory=list)
    ingestion_error: str | None = None
    retrieval_error: str | None = None
    ingestion_validation: PipelineValidationResult | None = None
    retrieval_validation: PipelineValidationResult | None = None
    #: Recent FAILED ingestion runs, scoped to the ones that are still true:
    #: each remaining run is the document it names' *current* attempt (a
    #: retry moves `Document.ingestion_run_id` onto the new run) and that
    #: document is still not READY. A run drops out the moment its document
    #: is retried successfully or removed -- see `build_context`.
    recent_ingestion_failures: list[models.PipelineRun] = field(default_factory=list)
    recent_retrieval_failures: list[models.PipelineRun] = field(default_factory=list)
    has_ingestion_run: bool = False

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
        ctx.ingestion = resolve_ingest_binding(session, user, collection)
        ctx.ingestion_validation = validate_pipeline_definition(
            session, user, ctx.ingestion.definition
        )
    except PipelineResolutionError as exc:
        ctx.ingestion_error = str(exc)
    try:
        ctx.retrieval = resolve_primary_tool(session, user, collection)
        ctx.retrieval_validation = validate_pipeline_definition(
            session, user, ctx.retrieval.definition
        )
    except PipelineResolutionError as exc:
        ctx.retrieval_error = str(exc)
    try:
        ctx.tool_bindings = resolve_tool_bindings(session, user, collection)
    except PipelineResolutionError:
        # A single unresolvable binding (foreign pipeline, no-longer-callable
        # graph) must not hide every *other* tool binding's diagnostics.
        ctx.tool_bindings = []

    runs = PipelineRunRepository(session)
    ingestion_failures = runs.list_recent_for_collection(
        collection.id,
        models.BindingRole.INGEST,
        status=models.PipelineRunStatus.FAILED,
        limit=_RECENT_FAILURE_LIMIT,
    )
    unresolved_run_ids = DocumentRepository(session).unresolved_ingestion_run_ids(
        run.id for run in ingestion_failures
    )
    ctx.recent_ingestion_failures = [
        run for run in ingestion_failures if run.id in unresolved_run_ids
    ]
    ctx.recent_retrieval_failures = runs.list_recent_for_collection(
        collection.id,
        models.BindingRole.TOOL,
        status=models.PipelineRunStatus.FAILED,
        limit=_RECENT_FAILURE_LIMIT,
    )
    ctx.has_ingestion_run = bool(
        runs.list_recent_for_collection(collection.id, models.BindingRole.INGEST, limit=1)
    )
    return ctx
