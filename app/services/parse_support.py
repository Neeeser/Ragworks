"""Whether a collection's ingestion pipeline reads a given content type.

Auto-ingest eligibility has two halves. The deployment's
`uploads.allowed_content_types` says which uploads may start a run at all;
this module answers the other half — whether the graph that would run has a
parse node claiming the type. A file no parse node reads produces nothing, so
answering before the run states a fact about the pipeline instead of failing
a document.

The claim is read statically off the bound definition (parse nodes declare
their registries), so nothing here executes a pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session

from app.db import models
from app.pipelines.content_coverage import claimed_content_types
from app.pipelines.registry import default_registry
from app.services.pipeline_resolution import PipelineResolutionError, resolve_ingest_binding


@dataclass(frozen=True)
class ParseSupport:
    """Whether the bound ingestion graph reads a type, and which graph answered."""

    reads: bool
    pipeline_name: str | None


def ingestion_parse_support(
    session: Session,
    user: models.User,
    collection: models.Collection,
    content_type: str,
) -> ParseSupport:
    """Report whether the collection's ingestion graph claims a content type.

    An unresolvable binding reads as supported: the upload proceeds and the
    run reports the real problem, rather than this check turning a resolution
    failure into an "unsupported format" verdict it cannot substantiate.
    Resolution is read-only (`scaffold=False`) — an upload must not be what
    persists a collection's default pipelines.
    """
    try:
        resolved = resolve_ingest_binding(session, user, collection, scaffold=False)
    except PipelineResolutionError:
        return ParseSupport(reads=True, pipeline_name=None)
    claim = claimed_content_types(resolved.static_definition, default_registry())
    return ParseSupport(
        reads=claim.reads(content_type),
        pipeline_name=resolved.pipeline.name,
    )


def unsupported_message(content_type: str, pipeline_name: str | None) -> str:
    """State which pipeline declined the type, and what to do about it."""
    subject = pipeline_name or "This collection's ingestion pipeline"
    return (
        f"{subject} has no parse node that reads {content_type}. Add one to "
        "the pipeline, or bind this collection to a pipeline that reads this "
        "format."
    )


def mark_unreadable_type(
    session: Session,
    user: models.User,
    collection: models.Collection,
    document: models.Document,
) -> None:
    """Record a document whose type the bound pipeline cannot read.

    Queueing it would spend a run to reach the same answer and record it as a
    failure — a pipeline reading a subset of what the deployment accepts is a
    configuration, not a fault. The caller commits.
    """
    support = ingestion_parse_support(session, user, collection, document.content_type)
    if support.reads:
        return
    document.status = models.DocumentStatus.UNSUPPORTED
    document.error_message = unsupported_message(document.content_type, support.pipeline_name)
    session.add(document)
    session.flush()
