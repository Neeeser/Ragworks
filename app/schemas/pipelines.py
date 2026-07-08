"""Pipeline schema models.

This module owns the pipeline API's wire contract. `PipelineDefinition` is
re-exported from the engine (`app/pipelines/definition.py`) because it *is*
the wire shape for pipeline graphs -- duplicating it here would just be a
second copy that drifts. Everything else the engine exposes on the wire
(node catalog entries, validation results) gets its own `*Read`/`*Response`
model defined here and mapped from the engine type at the route -- the
engine (`app/pipelines/`) must never be a source of wire types itself.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition
from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import PipelineKind


class PipelineCreate(BaseModel):
    """Payload for creating a pipeline."""

    name: str
    kind: PipelineKind
    definition: PipelineDefinition
    description: str | None = None
    change_summary: str | None = None


class PipelineUpdate(BaseModel):
    """Payload for updating a pipeline."""

    name: str | None = None
    description: str | None = None
    definition: PipelineDefinition | None = None
    change_summary: str | None = None


class PipelineRead(DateTimeConfigMixin, BaseModel):
    """Pipeline details returned to clients.

    Built at the route via
    `PipelineRead.model_validate({**pipeline.model_dump(), "definition": definition})`
    -- `definition` lives on the pipeline's current `PipelineVersion`, not on
    `models.Pipeline` itself, so it's the one field that can't come straight
    off the ORM row.
    """

    id: UUID
    user_id: UUID
    name: str
    description: str | None
    kind: PipelineKind
    current_version: int
    is_default: bool
    created_at: datetime
    updated_at: datetime
    definition: PipelineDefinition


class PipelineChangeRead(BaseModel):
    """One structural change a pipeline version introduced.

    Mapped from the engine's `app.pipelines.diff.DefinitionChange`; `kind`
    mirrors its change taxonomy (node_added, node_config, edge_removed, ...).
    """

    kind: str
    summary: str


class PipelineVersionRead(DateTimeConfigMixin, BaseModel):
    """Pipeline version details returned to clients."""

    id: UUID
    pipeline_id: UUID
    version: int
    created_at: datetime
    updated_at: datetime
    change_summary: str | None
    created_by: UUID | None
    changes: list[PipelineChangeRead] = Field(default_factory=list)


class NodePortRead(BaseModel):
    """Wire representation of a node input/output port."""

    key: str
    label: str
    data_type: str
    required: bool = True


class NodeSpecRead(BaseModel):
    """Wire representation of an available pipeline node type.

    Built via `NodeSpecRead.model_validate(spec, from_attributes=True)` from
    the engine's `app.pipelines.node.NodeSpec` at the route -- field names
    match exactly, so no field-by-field mapping is needed.
    """

    type: str
    label: str
    category: str
    description: str
    example: str
    input_ports: list[NodePortRead] = Field(default_factory=list)
    output_ports: list[NodePortRead] = Field(default_factory=list)
    config_schema: dict[str, object] = Field(default_factory=dict)
    default_config: dict[str, object] = Field(default_factory=dict)
    hidden: bool = False


class PipelineNodesResponse(BaseModel):
    """Response payload for node catalog requests."""

    nodes: list[NodeSpecRead]


class PipelineValidationResponse(BaseModel):
    """Response payload for pipeline validation."""

    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class PipelineActivateRequest(BaseModel):
    """Payload to activate a pipeline version."""

    version: int


class PipelineDeleteResponse(BaseModel):
    """Response payload for pipeline deletion."""

    status: str = "deleted"
