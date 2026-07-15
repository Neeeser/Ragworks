"""Schema models for pipeline trace responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.pipelines.definition import PipelineDefinition
from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import PipelineIOType, PipelineKind, PipelineRunStatus


class PipelineRunRead(DateTimeConfigMixin, BaseModel):
    """Pipeline run details returned to clients.

    Built via `PipelineRunRead.model_validate(run, from_attributes=True)` --
    every declared field is a plain column on `models.PipelineRun`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    pipeline_id: UUID
    pipeline_version_id: UUID | None
    pipeline_version: int | None
    kind: PipelineKind
    user_id: UUID
    collection_id: UUID
    status: PipelineRunStatus
    error_message: str | None
    warnings: list[str] = Field(default_factory=list)
    started_at: datetime
    completed_at: datetime | None


class PipelineNodeSummaryValueRead(BaseModel):
    """Summary value for a pipeline node input/output."""

    label: str
    value: Any
    kind: Literal["json", "text", "embedding", "items"] = "json"


class PipelineNodeSummaryRead(BaseModel):
    """Summary of key inputs and outputs for a node."""

    inputs: list[PipelineNodeSummaryValueRead] = Field(default_factory=list)
    outputs: list[PipelineNodeSummaryValueRead] = Field(default_factory=list)


class PipelineNodeRunRead(DateTimeConfigMixin, BaseModel):
    """Node execution details returned to clients.

    Built via `PipelineNodeRunRead.model_validate(node_run, from_attributes=True)`
    -- `summary` is a plain `dict` column on `models.PipelineNodeRun`; nested
    validation into `PipelineNodeSummaryRead` happens the same way it would
    for a dict passed to `model_validate` directly.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    node_id: str
    node_type: str
    node_name: str
    sequence_index: int
    status: PipelineRunStatus
    error_message: str | None
    started_at: datetime
    completed_at: datetime | None
    duration_ms: float | None
    summary: PipelineNodeSummaryRead


class PipelineNodeIORead(DateTimeConfigMixin, BaseModel):
    """Node input/output payloads returned to clients.

    Built via `PipelineNodeIORead.model_validate(io_record, from_attributes=True)`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_id: UUID
    node_run_id: UUID
    node_id: str
    io_type: PipelineIOType
    port: str
    payload: dict[str, Any]


class PipelineTraceResponse(BaseModel):
    """Pipeline trace response payload."""

    run: PipelineRunRead
    definition: PipelineDefinition
    node_runs: list[PipelineNodeRunRead]
    node_io: list[PipelineNodeIORead]


class TraceOriginRead(BaseModel):
    """Where a retrieved chunk came from: its source document and the
    ingestion run that put it into the index."""

    document_id: UUID
    document_name: str | None
    chunk_id: str | None
    trace: PipelineTraceResponse


class FocusedItemRead(BaseModel):
    """The concrete chunk behind a focused trace item.

    Trace identity lists carry only ids and scores; this is the live lookup
    that gives the focused result its text and document context. `status` is
    "missing" when the chunk id no longer resolves (deleted or re-ingested
    content) -- the journey still renders from the recorded lists.
    """

    id: str
    status: Literal["resolved", "missing"]
    text: str | None = None
    document_id: UUID | None = None
    filename: str | None = None
    chunk_index: int | None = None
    chunk_count: int | None = None


class DocumentTraceResponse(BaseModel):
    """An ingestion trace focused on one of the document's chunks.

    The chunk-focused variant of the plain document trace: same run payload,
    plus the live-resolved chunk behind the focused id.
    """

    trace: PipelineTraceResponse
    focused_item: FocusedItemRead | None = None


class EndToEndTraceResponse(BaseModel):
    """A retrieval trace joined with the origin ingestion trace.

    `origin` is None when the source document (or its ingestion run) can't be
    resolved -- the retrieval trace still stands on its own. `focused_item`
    is populated whenever a chunk id was requested, resolved or not.
    """

    retrieval: PipelineTraceResponse
    origin: TraceOriginRead | None = None
    focused_item: FocusedItemRead | None = None
