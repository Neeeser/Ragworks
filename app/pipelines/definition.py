"""Pipeline definition models for node-based workflows.

`PipelineDefinition` is the pipeline graph's wire contract (it is what
`app/schemas/pipelines.py` embeds directly in create/update/read payloads) as
well as the engine's own input, so it lives here rather than in
`app/schemas/` -- schemas re-export it rather than duplicating it.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.pipelines.variables import PipelineVariable

CURRENT_DEFINITION_SCHEMA_VERSION = 2
"""Bumped when a stored definition's shape changes (see `app/pipelines/upgrades.py`).

Version 2: variables own input declarations (`source="input"`); the
`retrieval.input` node's `arguments` config is a list of variable names; and
fusion nodes never truncate (a Result Limit node carries the cut). Stored raw
definitions *without* the key predate the field and are treated as version 1.
"""


class PipelineNodePosition(BaseModel):
    """UI positioning metadata for a pipeline node."""

    x: float
    y: float


class PipelineNodeDefinition(BaseModel):
    """Definition of a pipeline node within a workflow."""

    id: str
    type: str
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    position: PipelineNodePosition | None = None
    ui: dict[str, Any] = Field(default_factory=dict)


class PipelineEdgeDefinition(BaseModel):
    """Definition of a connection between pipeline nodes."""

    id: str
    source: str
    target: str
    source_port: str | None = None
    target_port: str | None = None
    ui: dict[str, Any] = Field(default_factory=dict)


class PipelineDefinition(BaseModel):
    """Complete pipeline graph definition.

    `viewport` stays a raw dict rather than a typed model: the frontend does
    not yet track editor viewport state (it always sends and expects `{}`),
    and every typed-model shape considered -- concrete float defaults,
    optional fields dumped as explicit nulls -- serializes an unset viewport
    to something other than `{}`, which is a wire-shape break for zero
    behavioral gain. Revisit once the editor actually persists pan/zoom.
    """

    nodes: list[PipelineNodeDefinition] = Field(default_factory=list)
    edges: list[PipelineEdgeDefinition] = Field(default_factory=list)
    viewport: dict[str, Any] = Field(default_factory=dict)
    variables: list[PipelineVariable] = Field(default_factory=list)
    # New payloads are current-shape by definition; the startup migration
    # detects legacy rows by the key's *absence* in the raw stored dict.
    schema_version: int = CURRENT_DEFINITION_SCHEMA_VERSION

    def node_map(self) -> dict[str, PipelineNodeDefinition]:
        """Return nodes keyed by id."""
        return {node.id: node for node in self.nodes}

    def outgoing_edges(self) -> dict[str, list[PipelineEdgeDefinition]]:
        """Return edges grouped by source node id."""
        grouped: dict[str, list[PipelineEdgeDefinition]] = {}
        for edge in self.edges:
            grouped.setdefault(edge.source, []).append(edge)
        return grouped

    def incoming_edges(self) -> dict[str, list[PipelineEdgeDefinition]]:
        """Return edges grouped by target node id."""
        grouped: dict[str, list[PipelineEdgeDefinition]] = {}
        for edge in self.edges:
            grouped.setdefault(edge.target, []).append(edge)
        return grouped
