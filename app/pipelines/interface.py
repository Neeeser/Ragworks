"""Derived pipeline interfaces: what a graph can do, read off its boundary nodes.

The interface is derived from the definition — never author-declared flags —
so it can never contradict the graph. It answers two questions everything
binding-related asks: can this pipeline run on a document (serve as a
collection's ingest binding)? and can it be called with arguments (be exposed
as a tool)? For callable pipelines it also carries the tool projection chat
and MCP render from: tool identity, declared arguments, and the result shape.

`PipelineService` materializes the derived interface onto each immutable
`PipelineVersion` at save time (a version's definition never changes, so the
stored copy cannot drift) and re-derives lazily for versions saved before the
column existed.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field, ValidationError

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.io import (
    IngestionInputNode,
    RetrievalInputConfig,
    RetrievalInputNode,
    RetrievalOutputConfig,
    RetrievalOutputNode,
)
from app.pipelines.resolution import declared_arguments, resolve_static_definition
from app.pipelines.variables import PipelineInputArgument

#: Reserved terminal-node type id for structured (non-chunk) tool results.
#: The node class ships with the first structured tool node; the id is pinned
#: here so interface derivation recognizes it the moment it exists.
TOOL_OUTPUT_NODE_TYPE = "tool.output"


class ToolOutputKind(StrEnum):
    """The result shape a callable pipeline produces."""

    CHUNKS = "chunks"
    STRUCTURED = "structured"


class PipelineInterface(BaseModel):
    """A pipeline's derived capabilities and tool projection."""

    accepts_document: bool = False
    callable: bool = False
    tool_name: str | None = None
    tool_description: str | None = None
    arguments: list[PipelineInputArgument] = Field(default_factory=list)
    output_fields: list[str] = Field(default_factory=list)
    output_kind: ToolOutputKind | None = None


def _first_node(
    definition: PipelineDefinition, node_type: str
) -> PipelineNodeDefinition | None:
    """Return the first node of the given type, if present."""
    return next((node for node in definition.nodes if node.type == node_type), None)


def _tool_identity(node: PipelineNodeDefinition | None) -> tuple[str | None, str | None]:
    """Read the tool name/description off the query-input node's config."""
    if node is None:
        return None, None
    try:
        config = RetrievalInputConfig.model_validate(node.config or {})
    except ValidationError:
        return None, None
    name = (config.tool_name or "").strip() or None
    description = (config.tool_description or "").strip() or None
    return name, description


def _output_fields(node: PipelineNodeDefinition | None) -> list[str]:
    """Read the declared output field names off a terminal node's config."""
    if node is None:
        return []
    try:
        config = RetrievalOutputConfig.model_validate(node.config or {})
    except ValidationError:
        return []
    return [output.name for output in config.outputs]


def derive_interface(definition: PipelineDefinition) -> PipelineInterface:
    """Derive a pipeline's interface from its definition.

    Configs are read through the static-resolved view (expressions replaced
    by their default-environment values) so an expression-tagged config never
    crashes derivation — the same rule every static consumer follows.
    """
    static = resolve_static_definition(definition)
    input_node = _first_node(static, RetrievalInputNode.type)
    tool_name, tool_description = _tool_identity(input_node)
    chunk_output = _first_node(static, RetrievalOutputNode.type)
    structured_output = _first_node(static, TOOL_OUTPUT_NODE_TYPE)
    output_kind: ToolOutputKind | None = None
    if chunk_output is not None:
        output_kind = ToolOutputKind.CHUNKS
    elif structured_output is not None:
        output_kind = ToolOutputKind.STRUCTURED
    return PipelineInterface(
        accepts_document=_first_node(static, IngestionInputNode.type) is not None,
        callable=input_node is not None,
        tool_name=tool_name,
        tool_description=tool_description,
        arguments=declared_arguments(static) if input_node is not None else [],
        output_fields=_output_fields(chunk_output or structured_output),
        output_kind=output_kind,
    )
