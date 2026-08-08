"""Diagnostics over a collection configuration that does not exist yet.

The collection wizard can pair pipelines the diagnostics rules already know
are broken -- ingestion writing one embedding model while the search tool
queries another, the two sides pointing at different indexes -- and today
those findings only appear after the collection is created. This module runs
the *same* registered rules over a transient context so the wizard can warn
before Create, rather than deriving a second rulebook client-side.

Two things make the context transient: the collection is an unpersisted
`models.Collection` (nothing is added to the session), and each side is
resolved through `resolve_unbound_pipeline` instead of a binding row. The
collection's id and name therefore differ from the ones the created
collection will carry, which only matters to expressions built from
`{{collection.*}}`: both sides resolve against the *same* placeholder, so a
cross-side comparison is exactly as true before creation as after.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.schemas.diagnostics import CollectionDiagnosticsPreviewRequest
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.prober import VectorStoreProber
from app.services.diagnostics.rules.base import DiagnosticRule
from app.services.diagnostics.rules.registry import DIAGNOSTIC_RULES
from app.services.pipeline_resolution import (
    PipelineResolutionError,
    ResolvedPipeline,
    resolve_unbound_pipeline,
)
from app.services.pipeline_validation import validate_pipeline_definition

#: Rules the preview does not run, and why. Each one reads state that only
#: exists once the collection does, so running it pre-creation would either
#: report the empty state as a finding or fake an answer.
EXCLUDED_PREVIEW_RULES: dict[str, str] = {
    "index_probe": (
        "Probes the live store for the index the first ingestion run creates. "
        "Before creation every target reads as not-created-yet, which is the "
        "expected state and not a pairing problem -- and the probe is a "
        "network call on a path that re-runs on every selection change."
    ),
    "recent_ingestion_failures": (
        "Reads persisted ingestion runs; a collection that does not exist has none."
    ),
    "recent_retrieval_failures": (
        "Reads persisted retrieval runs; a collection that does not exist has none."
    ),
}

#: Every registered rule whose inputs a transient context can supply.
PREVIEW_RULES: list[DiagnosticRule] = [
    rule for rule in DIAGNOSTIC_RULES if rule.code not in EXCLUDED_PREVIEW_RULES
]


def _placeholder_collection(user: models.User) -> models.Collection:
    """Build the unpersisted collection the preview resolves against."""
    return models.Collection(
        user_id=user.id,
        name="New collection",
        description="",
        extra_metadata={},
    )


def build_preview_context(
    session: Session,
    user: models.User,
    request: CollectionDiagnosticsPreviewRequest,
) -> DiagnosticContext:
    """Resolve the wizard's intended pairing into a rule-ready context.

    A side whose pipeline cannot be resolved (deleted, foreign, or wrong
    interface for its role) records its failure the way `build_context` does
    -- as a `*_error` string -- so the comparison rules stay silent instead of
    the preview failing.
    """
    collection = _placeholder_collection(user)
    ctx = DiagnosticContext(
        collection=collection,
        user=user,
        session=session,
        prober=VectorStoreProber(user, session),
    )
    if request.ingest_pipeline_id is not None:
        try:
            ctx.ingestion = resolve_unbound_pipeline(
                session,
                user,
                collection,
                request.ingest_pipeline_id,
                models.BindingRole.INGEST,
            )
            ctx.ingestion_validation = validate_pipeline_definition(
                session, user, ctx.ingestion.definition
            )
        except PipelineResolutionError as exc:
            ctx.ingestion_error = str(exc)
    slots = _resolve_tools(session, user, collection, request)
    ctx.tool_bindings = [resolved for resolved in slots if resolved is not None]
    # The *first chosen* tool is the primary search tool, the side every
    # ingestion-vs-retrieval rule compares against. When that choice does not
    # resolve, retrieval is unresolved -- exactly what the created collection
    # would report. Promoting the second tool here would make the preview
    # disagree with the collection it previews.
    primary = slots[0] if slots else None
    if primary is not None:
        ctx.retrieval = primary
        ctx.retrieval_validation = validate_pipeline_definition(
            session, user, primary.definition
        )
    elif request.tool_pipeline_ids:
        ctx.retrieval_error = "Primary search tool could not be resolved."
    return ctx


def _resolve_tools(
    session: Session,
    user: models.User,
    collection: models.Collection,
    request: CollectionDiagnosticsPreviewRequest,
) -> list[ResolvedPipeline | None]:
    """Resolve each chosen tool pipeline, keeping its position.

    A slot is `None` when that choice cannot be resolved. Positions are kept
    because the first slot is the primary tool: dropping a failed one would
    silently promote the next choice into a role the created collection would
    not give it. One unresolvable choice still leaves the others' findings
    intact -- the same degradation `build_context` applies to real bindings.
    """
    resolved: list[ResolvedPipeline | None] = []
    for pipeline_id in request.tool_pipeline_ids:
        try:
            resolved.append(
                resolve_unbound_pipeline(
                    session, user, collection, pipeline_id, models.BindingRole.TOOL
                )
            )
        except PipelineResolutionError:
            resolved.append(None)
    return resolved
