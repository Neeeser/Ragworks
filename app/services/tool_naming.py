"""Tool-name derivation and collision checking for collection tool bindings.

Split out from `tool_projection.py` (which also depends on
`pipeline_resolution`, itself depending on `pipelines.py`) so `PipelineService`
can enforce tool-name uniqueness at save time without an import cycle: this
module has no dependency on either.

Naming is collection-namespaced: `tool_exposed_name` appends only the
collection's own slug to a pipeline's base tool identity, so two *different*
collections sharing a base name never collide in one chat session (the `_N`
dedup in `app/chat/tool_contexts.py` and `app/mcp/tools/bindings.py` covers
that case, and covers pre-existing stored duplicates within one collection).
`ensure_unique_tool_names` is the *within-one-collection* half: it refuses to
let a new collision be created, because a `search_x`/`search_x_2` pair gives
the model no way to tell the two tools apart, and which one is `_2` depends on
load order — an unstable identifier is worse than a rejected save.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from app.db import models
from app.pipelines.interface import PipelineInterface
from app.services.errors import InvalidInputError

#: Base identity used when a pipeline's query-input node declares none.
DEFAULT_TOOL_BASE_NAME = "search"


def slugify_tool_name(value: str) -> str:
    """Reduce a name to the provider-safe tool-name alphabet."""
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def tool_base_name(interface: PipelineInterface) -> str:
    """Return the pipeline's base tool name (editor-declared, else "search")."""
    declared = slugify_tool_name(interface.tool_name or "")
    return declared or DEFAULT_TOOL_BASE_NAME


def tool_exposed_name(base_name: str, collection_name: str) -> str:
    """Namespace a base tool name by its collection for exposure."""
    slug = slugify_tool_name(collection_name)
    return f"{base_name}_{slug or 'collection'}"


def ensure_unique_tool_names(
    pipelines: Iterable[tuple[models.Pipeline, PipelineInterface]],
) -> None:
    """Raise `InvalidInputError` when two pipelines share a base tool name.

    Every pair in `pipelines` is assumed to belong to (or be about to belong
    to) the same collection -- the caller scopes the iterable. The message
    names both colliding pipelines and the field that fixes it, because the
    fix is a save the user can make immediately.
    """
    seen: dict[str, models.Pipeline] = {}
    for pipeline, interface in pipelines:
        base = tool_base_name(interface)
        other = seen.get(base)
        if other is not None:
            raise InvalidInputError(
                f"Pipelines '{other.name}' and '{pipeline.name}' would both expose the "
                f"tool name '{base}' in this collection. Set a unique 'tool_name' on the "
                "query-input node of one of them."
            )
        seen[base] = pipeline
