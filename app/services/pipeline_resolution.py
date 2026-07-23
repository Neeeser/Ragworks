"""The one place that resolves a collection's pipeline bindings.

Every caller that needs a collection's active pipelines follows the same
sequence: ensure default pipelines exist for the user, bind them to the
collection if it has no bindings yet, load the bound pipeline, check its
derived interface fits the binding's role, and resolve its settings against
the collection. This module is the only place that sequence is written;
callers (ingestion, tool invocation, chat setup, prompt rendering, purges,
diagnostics) all go through `resolve_ingest_binding` / `resolve_primary_tool`
/ `resolve_tool_binding` / `resolve_tool_bindings`.

Resolution failures raise `PipelineResolutionError`, never an HTTP exception —
this is a service module, so translating to a status code is the caller's job
(it is an `InvalidInputError`, so routes map it to 400).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.interface import PipelineInterface
from app.pipelines.registry import NodeRegistry, default_registry
from app.pipelines.settings import IndexTarget, PipelineSettings, resolve_pipeline_settings
from app.services.errors import InvalidInputError
from app.services.pipeline_validation import log_pipeline_validation_warnings
from app.services.pipelines import PipelineService


class PipelineResolutionError(InvalidInputError):
    """Raised when a collection's pipeline binding cannot be resolved.

    Subclasses `InvalidInputError` so routes map it to a 400 through the
    typed taxonomy.
    """


@dataclass(frozen=True)
class ResolvedPipeline:
    """A resolved binding: its pipeline, definition, settings, and interface."""

    service: PipelineService
    binding: models.CollectionPipelineBinding
    pipeline: models.Pipeline
    definition: PipelineDefinition
    settings: PipelineSettings
    interface: PipelineInterface


def _load_resolved(
    service: PipelineService,
    user: models.User,
    collection: models.Collection,
    binding: models.CollectionPipelineBinding,
    registry: NodeRegistry | None,
    *,
    context: str,
) -> ResolvedPipeline:
    """Load a binding's pipeline and check its interface fits the role."""
    pipeline = service.get_pipeline(binding.pipeline_id, user.id)
    if not pipeline:
        raise PipelineResolutionError(f"{context} pipeline could not be resolved.")
    definition = service.get_definition(pipeline)
    interface = service.interface_for(pipeline)
    if binding.role == models.BindingRole.INGEST and not interface.accepts_document:
        raise PipelineResolutionError(
            f"Pipeline '{pipeline.name}' does not accept documents and cannot ingest."
        )
    if binding.role == models.BindingRole.TOOL and not interface.callable:
        raise PipelineResolutionError(
            f"Pipeline '{pipeline.name}' has no query input and cannot serve as a tool."
        )
    log_pipeline_validation_warnings(
        service.validate_definition(user, definition), context=f"{context} execution"
    )
    settings = resolve_pipeline_settings(
        definition, collection, registry or default_registry()
    )
    return ResolvedPipeline(
        service=service,
        binding=binding,
        pipeline=pipeline,
        definition=definition,
        settings=settings,
        interface=interface,
    )


def _scaffold_bindings(
    service: PipelineService, user: models.User, collection: models.Collection
) -> None:
    """Persist default pipelines and bind them onto an unbound collection."""
    defaults = service.ensure_default_pipelines(user)
    service.ensure_collection_bindings(collection, defaults)


def resolve_ingest_binding(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    registry: NodeRegistry | None = None,
    scaffold: bool = True,
) -> ResolvedPipeline:
    """Resolve the collection's ingest binding.

    `scaffold=True` (default) runs ensure-defaults → bind, which *persists*
    default pipelines and binds them to the collection — correct for callers
    about to run a pipeline. `scaffold=False` is the read-only variant: it
    never mutates state (no GET endpoint may), so an unbound collection
    raises `PipelineResolutionError` instead of scaffolding. Diagnostics
    uses `scaffold=False`.
    """
    service = PipelineService(session)
    bindings = CollectionPipelineBindingRepository(session)
    existing = bindings.list_for_collection(collection.id, role=models.BindingRole.INGEST)
    if not existing:
        if not scaffold:
            raise PipelineResolutionError(
                "No ingestion pipeline is bound to this collection."
            )
        _scaffold_bindings(service, user, collection)
        existing = bindings.list_for_collection(
            collection.id, role=models.BindingRole.INGEST
        )
    if not existing:
        raise PipelineResolutionError("Ingestion pipeline could not be resolved.")
    return _load_resolved(
        service, user, collection, existing[0], registry, context="ingestion"
    )


def resolve_primary_tool(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    registry: NodeRegistry | None = None,
    scaffold: bool = True,
) -> ResolvedPipeline:
    """Resolve the collection's primary search tool binding.

    See `resolve_ingest_binding` for the `scaffold` contract. The primary is
    the designated default the search page, files search, and legacy query
    API run against.
    """
    service = PipelineService(session)
    bindings = CollectionPipelineBindingRepository(session)
    tools = bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL)
    if not tools:
        if not scaffold:
            raise PipelineResolutionError("No tool pipeline is bound to this collection.")
        _scaffold_bindings(service, user, collection)
        tools = bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL)
    primary = next((binding for binding in tools if binding.is_primary), None)
    if primary is None:
        primary = tools[0] if tools else None
    if primary is None:
        raise PipelineResolutionError("Primary search tool could not be resolved.")
    return _load_resolved(
        service, user, collection, primary, registry, context="retrieval"
    )


def resolve_tool_binding(
    session: Session,
    user: models.User,
    collection: models.Collection,
    binding_id: UUID,
    *,
    registry: NodeRegistry | None = None,
) -> ResolvedPipeline:
    """Resolve one specific tool binding of a collection (never scaffolds)."""
    bindings = CollectionPipelineBindingRepository(session)
    binding = bindings.get_for_collection(collection.id, binding_id)
    if binding is None or binding.role != models.BindingRole.TOOL:
        raise PipelineResolutionError("Tool binding could not be resolved.")
    return _load_resolved(
        PipelineService(session), user, collection, binding, registry, context="tool"
    )


@dataclass(frozen=True)
class PurgeTarget:
    """One (index, namespace) pair a collection's pipelines touch.

    Purge cascades iterate these — the union across EVERY binding, because a
    tool pipeline with an indexer node writes to indexes the ingest pipeline
    never touched.
    """

    target: IndexTarget
    namespace: str | None


def resolve_purge_targets(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    registry: NodeRegistry | None = None,
) -> list[PurgeTarget]:
    """Return the deduped union of index targets across all bindings.

    The ingest binding must resolve (its failure propagates, as deletion
    always required); a tool binding that no longer resolves is skipped —
    an unresolvable graph never ran, and blocking deletion on it would trap
    the collection.
    """
    resolved: list[ResolvedPipeline] = [
        resolve_ingest_binding(session, user, collection, registry=registry)
    ]
    bindings = CollectionPipelineBindingRepository(session)
    for binding in bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL):
        try:
            resolved.append(
                resolve_tool_binding(session, user, collection, binding.id, registry=registry)
            )
        except PipelineResolutionError:
            continue
    targets: list[PurgeTarget] = []
    seen: set[tuple[IndexTarget, str | None]] = set()
    for item in resolved:
        for target in item.settings.index_targets:
            key = (target, item.settings.namespace)
            if key in seen:
                continue
            seen.add(key)
            targets.append(PurgeTarget(target=target, namespace=item.settings.namespace))
    return targets


def resolve_tool_bindings(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    registry: NodeRegistry | None = None,
    enabled_only: bool = True,
    scaffold: bool = True,
) -> list[ResolvedPipeline]:
    """Resolve the collection's tool bindings in position order.

    Chat setup uses this (enabled bindings only); the tools listing endpoint
    passes `enabled_only=False` to show disabled bindings too.
    """
    service = PipelineService(session)
    bindings = CollectionPipelineBindingRepository(session)
    tools = bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL)
    if not tools and scaffold:
        _scaffold_bindings(service, user, collection)
        tools = bindings.list_for_collection(collection.id, role=models.BindingRole.TOOL)
    resolved: list[ResolvedPipeline] = []
    for binding in tools:
        if enabled_only and not binding.enabled:
            continue
        resolved.append(
            _load_resolved(service, user, collection, binding, registry, context="tool")
        )
    return resolved
