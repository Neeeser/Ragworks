"""Tool projections: the LLM-facing view of a resolved tool binding.

One place turns a resolved binding into the projection every exposure surface
uses — chat tool specs, the collection tools API, and the planned MCP listing.
Naming is collection-namespaced: the pipeline carries a base tool identity
(`tool_name` on its query-input node, "search" when unset) and the exposed
name appends the collection slug, so two collections sharing one pipeline
never collide in a chat session and the pre-tools `search_<collection>`
contract survives unchanged.
"""

from __future__ import annotations

import re

from app.db import models
from app.pipelines.interface import PipelineInterface, ToolOutputKind
from app.pipelines.variables import PipelineInputArgument, VariableType
from app.schemas.retrieval import QueryArgumentRead
from app.schemas.tools import CollectionToolRead
from app.services.pipeline_resolution import ResolvedPipeline

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


def tool_description(
    interface: PipelineInterface, collection: models.Collection
) -> str:
    """Build the exposed tool description.

    A pipeline-declared description leads; otherwise the historical search
    framing applies. The collection's own description is always appended so
    the model knows what corpus the tool reaches.
    """
    parts: list[str] = []
    declared = (interface.tool_description or "").strip()
    if declared:
        parts.append(declared)
        parts.append(f"Operates on the document collection '{collection.name}'.")
    else:
        parts.append(f"Search the document collection '{collection.name}'.")
    collection_description = (collection.description or "").strip()
    if collection_description:
        parts.append(collection_description)
    if not declared:
        parts.append(
            "Always call this tool before answering questions about documents in this collection."
        )
    return " ".join(parts)


def build_parameter_schema(
    arguments: tuple[PipelineInputArgument, ...],
) -> dict[str, object]:
    """Build a tool's JSON parameter schema from its pipeline's declared arguments.

    A pipeline declaring no arguments keeps the historical contract (`query`
    plus the built-in 1-10 `top_k`); a declaring pipeline publishes exactly
    its `expose_to_llm` arguments beside the always-required `query`.
    """
    properties: dict[str, object] = {
        "query": {
            "type": "string",
            "description": "Natural language search query.",
        }
    }
    required = ["query"]
    if not arguments:
        properties["top_k"] = {
            "type": "integer",
            "description": "How many chunks to retrieve (max 10).",
            "default": 5,
            "minimum": 1,
            "maximum": 10,
        }
        return {"type": "object", "properties": properties, "required": required}
    for argument in arguments:
        if not argument.expose_to_llm or argument.type is VariableType.MODEL:
            continue
        properties[argument.name] = _argument_property(argument)
        if argument.required:
            required.append(argument.name)
    return {"type": "object", "properties": properties, "required": required}


def _argument_property(argument: PipelineInputArgument) -> dict[str, object]:
    """Map one declared argument onto its JSON Schema property."""
    if argument.type is VariableType.ENUM:
        prop: dict[str, object] = {"type": "string", "enum": list(argument.choices)}
    else:
        prop = {"type": argument.type.value}
    if argument.description:
        prop["description"] = argument.description
    if argument.default is not None:
        prop["default"] = argument.default
    if argument.minimum is not None:
        prop["minimum"] = argument.minimum
    if argument.maximum is not None:
        prop["maximum"] = argument.maximum
    return prop


def to_tool_read(
    resolved: ResolvedPipeline,
    collection: models.Collection,
    *,
    exposed_name: str | None = None,
) -> CollectionToolRead:
    """Project a resolved tool binding onto its wire/LLM shape.

    `exposed_name` lets chat pass its de-duplicated name (`_2`, `_3` suffixes
    when one session loads same-named tools); other surfaces take the default
    collection-namespaced name.
    """
    interface = resolved.interface
    base = tool_base_name(interface)
    return CollectionToolRead(
        id=resolved.binding.id,
        collection_id=collection.id,
        pipeline_id=resolved.pipeline.id,
        pipeline_name=resolved.pipeline.name,
        name=exposed_name or tool_exposed_name(base, collection.name),
        base_name=base,
        description=tool_description(interface, collection),
        parameters=build_parameter_schema(tuple(interface.arguments)),
        arguments=[
            QueryArgumentRead.model_validate(argument.model_dump())
            for argument in interface.arguments
        ],
        output_kind=(interface.output_kind or ToolOutputKind.CHUNKS).value,
        output_fields=list(interface.output_fields),
        is_primary=resolved.binding.is_primary,
        enabled=resolved.binding.enabled,
        position=resolved.binding.position,
    )
