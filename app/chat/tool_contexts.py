"""Per-collection tool-context resolution for a chat turn.

Split from `setup.py` (which orchestrates the whole turn): this module turns
the selected collections into `ToolCollectionContext`s — every enabled tool
binding projected under a turn-unique exposed name, plus the per-collection
prompt settings.
"""

from __future__ import annotations

from sqlmodel import Session

from app.chat.state import ToolCollectionContext, ToolContext
from app.db import models
from app.services.pipeline_resolution import (
    ResolvedPipeline,
    resolve_ingest_binding,
    resolve_tool_bindings,
)
from app.services.prompts import collection_tool_name
from app.services.tool_projection import (
    build_parameter_schema,
    tool_base_name,
    tool_description,
    tool_exposed_name,
)


def _tool_context(
    collection: models.Collection,
    resolved: ResolvedPipeline,
    exposed_name: str,
) -> ToolContext:
    """Project one resolved tool binding onto its chat-facing context."""
    return ToolContext(
        collection=collection,
        binding_id=resolved.binding.id,
        tool_name=exposed_name,
        description=tool_description(resolved.interface, collection),
        parameters=build_parameter_schema(tuple(resolved.interface.arguments)),
        settings=resolved.settings,
        query_arguments=tuple(resolved.interface.arguments),
    )


def tool_contexts_for_collections(
    session: Session, user: models.User, collections: list[models.Collection]
) -> list[ToolCollectionContext]:
    """Build per-collection contexts with turn-uniquely named tools.

    Every enabled tool binding of every selected collection is exposed;
    names collide across collections sharing a pipeline (or same-named
    collections), so the `_2`/`_3` dedup applies across the whole turn.
    `PipelineResolutionError` subclasses `InvalidInputError`, so it flows
    through the same `except ServiceError` the routes use for every other
    chat domain error.
    """
    name_counts: dict[str, int] = {}
    contexts: list[ToolCollectionContext] = []
    for collection in collections:
        ingest = resolve_ingest_binding(session, user, collection)
        resolved_tools = resolve_tool_bindings(session, user, collection)
        tools: list[ToolContext] = []
        for resolved in resolved_tools:
            base_name = tool_exposed_name(
                tool_base_name(resolved.interface), collection.name
            )
            occurrence = name_counts.get(base_name, 0) + 1
            name_counts[base_name] = occurrence
            exposed = base_name if occurrence == 1 else f"{base_name}_{occurrence}"
            tools.append(_tool_context(collection, resolved, exposed))
        primary = next(
            (
                tool
                for tool, resolved in zip(tools, resolved_tools, strict=True)
                if resolved.binding.is_primary
            ),
            tools[0] if tools else None,
        )
        primary_resolved = next(
            (resolved for resolved in resolved_tools if resolved.binding.is_primary),
            resolved_tools[0] if resolved_tools else None,
        )
        contexts.append(
            ToolCollectionContext(
                collection=collection,
                tool_name=(
                    primary.tool_name if primary else collection_tool_name(collection.name)
                ),
                ingestion_settings=ingest.settings,
                retrieval_settings=(
                    primary_resolved.settings if primary_resolved else ingest.settings
                ),
                tools=tuple(tools),
                query_arguments=(
                    tuple(primary_resolved.interface.arguments) if primary_resolved else ()
                ),
            )
        )
    return contexts
