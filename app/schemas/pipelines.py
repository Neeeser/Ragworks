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
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition
from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import IndexBackend, PipelineKind


class PipelineCreate(BaseModel):
    """Payload for creating a pipeline.

    `kind` is accepted for wire compatibility but ignored — what a pipeline
    can do is derived from its definition's boundary nodes, never stored.
    """

    name: str
    definition: PipelineDefinition
    kind: PipelineKind | None = None
    description: str | None = None
    change_summary: str | None = None


class PipelineCopyRequest(BaseModel):
    """Payload for copying a pipeline.

    `name` is optional so the common case is a one-click copy; the service
    derives "<name> (copy)" when it is omitted.
    """

    name: str | None = None


class PipelineUpdate(BaseModel):
    """Payload for updating a pipeline."""

    name: str | None = None
    description: str | None = None
    definition: PipelineDefinition | None = None
    change_summary: str | None = None


class PipelineInterfaceRead(BaseModel):
    """A pipeline's derived interface, as served to clients.

    Mirrors the engine's `PipelineInterface` (mapped at the route — the
    engine never defines wire types). `arguments` reuses the query-argument
    wire shape the search surfaces already render from.
    """

    accepts_document: bool = False
    callable: bool = False
    tool_name: str | None = None
    tool_description: str | None = None
    output_kind: Literal["chunks", "structured"] | None = None
    output_fields: list[str] = Field(default_factory=list)


class PipelineRead(DateTimeConfigMixin, BaseModel):
    """Pipeline details returned to clients.

    Built at the route via
    `PipelineRead.model_validate({**pipeline.model_dump(), "definition": definition})`
    -- `definition` lives on the pipeline's current `PipelineVersion`, not on
    `models.Pipeline` itself. `kind` and `interface` are derived from the
    definition (there is no stored kind); `is_default` reflects the
    template_slug that marks scaffolded defaults.
    """

    id: UUID
    user_id: UUID
    name: str
    description: str | None
    kind: PipelineKind | None = None
    interface: PipelineInterfaceRead | None = None
    current_version: int
    is_default: bool
    created_at: datetime
    updated_at: datetime
    definition: PipelineDefinition
    validation_issues: list[PipelineValidationIssueRead] = Field(default_factory=list)


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
    """Wire representation of a node input/output port.

    The facet fields feed the editor's client-side facet inference (the
    mirror of `app/pipelines/facets.py`) — dropping one leaves that
    implementation computing a different answer from the server's on every
    graph the field applies to. `accepts`/`unaccepted` decide whether a
    node's `adds` and `removes` reach the whole stream, so the two
    inferences agree only when all six travel.
    """

    key: str
    label: str
    data_type: str
    required: bool = True
    accepts_many: bool = False
    requires: tuple[str, ...] = ()
    accepts: tuple[str, ...] = ()
    unaccepted: Literal["passthrough", "exclude"] = "passthrough"
    adds: tuple[str, ...] = ()
    optional_adds: tuple[str, ...] = ()
    preserves: bool = False
    removes: tuple[str, ...] = ()


class NodePresetRead(BaseModel):
    """Wire representation of one named starting configuration."""

    id: str
    label: str
    description: str
    config: dict[str, object] = Field(default_factory=dict)


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
    #: Vector-store backends this node works with (`None` for store-agnostic
    #: nodes). The editor uses it to flag a node the selected backend can't run.
    supported_backends: list[str] | None = None
    presets: list[NodePresetRead] = Field(default_factory=list)
    #: Content types this node's parser registry answers for (`None` for
    #: nodes that parse nothing). Coverage against the auto-ingest list is
    #: computed server-side (`app/pipelines/content_coverage.py`).
    handled_content_types: list[str] | None = None
    #: The selected model widens this node's `accepts` beyond its floor, so
    #: client-side modality findings that a model choice could cure are left
    #: to server validation.
    model_widens_accepts: bool = False


class PipelineNodesResponse(BaseModel):
    """Response payload for node catalog requests."""

    nodes: list[NodeSpecRead]


class PipelineValidationIssueRead(BaseModel):
    """Field-addressable pipeline validation issue returned to the editor."""

    code: str | None = None
    message: str
    severity: Literal["error", "warning"]
    node_id: str | None = None
    field: str | None = None
    configured_value: str | int | float | bool | None = None
    model: str | None = None
    allowed_max: int | None = None


class PipelineValidationResponse(BaseModel):
    """Response payload for pipeline validation."""

    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    issues: list[PipelineValidationIssueRead] = Field(default_factory=list)


class PipelineValidationErrorDetail(BaseModel):
    """The `detail` a rejected save or create carries.

    Both fields describe the same findings: `errors` is the flat message list,
    `issues` the same errors carrying the node each one belongs to. A client
    with nowhere to attribute a finding renders the messages; one drawing the
    graph groups the issues under their nodes.
    """

    errors: list[str] = Field(default_factory=list)
    issues: list[PipelineValidationIssueRead] = Field(default_factory=list)


class ToolTemplateRead(BaseModel):
    """One starting point the create-pipeline wizard offers."""

    id: str
    label: str
    description: str
    needs_embedding: bool
    needs_reranker: bool
    needs_store: bool
    #: Which kind of index the template's graph reads, so the wizard offers
    #: that kind rather than one the graph never touches.
    index_vector_type: Literal["dense", "sparse"] | None = None
    supported_backends: list[IndexBackend]


class ToolTemplatesResponse(BaseModel):
    """Response payload for the tool-template catalog."""

    templates: list[ToolTemplateRead]


class ToolTemplateScaffoldRequest(BaseModel):
    """The wizard's choices, from which the server builds the template's graph."""

    backend: IndexBackend
    index_name: str | None = None
    embedding_connection_id: UUID | None = None
    embedding_model: str | None = None
    reranking_connection_id: UUID | None = None
    reranking_model: str | None = None


class PipelineActivateRequest(BaseModel):
    """Payload to activate a pipeline version."""

    version: int


class PipelineDeleteResponse(BaseModel):
    """Response payload for pipeline deletion."""

    status: str = "deleted"
