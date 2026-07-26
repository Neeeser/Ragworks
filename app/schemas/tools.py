"""Collection tool schema models.

The tool projection (`CollectionToolRead`) is the LLM-facing view of a tool
binding: exposed name, description, JSON-schema parameters, and result shape.
Chat advertises exactly this projection to providers, and the planned MCP
exposure serves the same shape — it is defined once here so the two can never
drift. `ToolInvocationResponse` is the discriminated result: `chunks`-kind
tools return scored chunks (today's retrieval contract), `structured`-kind
tools return only their declared output fields.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.retrieval import QueryArgumentRead, RetrievedChunk

ToolResultKind = Literal["chunks", "structured"]


class CollectionToolRead(BaseModel):
    """One tool binding's projection, as chat and MCP expose it."""

    id: UUID
    collection_id: UUID
    pipeline_id: UUID
    pipeline_name: str
    name: str
    base_name: str
    description: str
    parameters: dict[str, Any]
    arguments: list[QueryArgumentRead] = Field(default_factory=list)
    output_kind: ToolResultKind
    output_fields: list[str] = Field(default_factory=list)
    is_primary: bool
    enabled: bool
    position: int
    variable_values: dict[str, Any] = Field(default_factory=dict)


class CollectionToolsResponse(BaseModel):
    """A collection's tool listing plus its ingest binding."""

    tools: list[CollectionToolRead]
    ingest_pipeline_id: UUID | None = None


class ToolInvokeRequest(BaseModel):
    """Payload for invoking one tool binding directly."""

    query: str
    top_k: int | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolInvocationResponse(BaseModel):
    """The discriminated result of running a tool binding."""

    kind: ToolResultKind
    tool_binding_id: UUID
    query: str
    top_k: int
    chunks: list[RetrievedChunk] = Field(default_factory=list)
    outputs: dict[str, Any] = Field(default_factory=dict)
    usage: dict[str, Any] = Field(default_factory=dict)
    query_event_id: UUID | None = None
    pipeline_run_id: UUID | None = None


class CollectionToolCreate(BaseModel):
    """Payload for binding a pipeline as a collection tool.

    `variable_values` answers the pipeline's binding-source variables for
    this collection — chiefly which index it targets. Omitted slots auto-fill
    from the collection's existing indexes.
    """

    pipeline_id: UUID
    variable_values: dict[str, Any] = Field(default_factory=dict)


class CollectionToolUpdate(BaseModel):
    """Payload for updating one tool binding (primary/enabled/variables).

    `variable_values` is `None` when the caller is not changing it; an empty
    dict deliberately clears every override back to the pipeline defaults.
    """

    is_primary: bool | None = None
    enabled: bool | None = None
    variable_values: dict[str, Any] | None = None
