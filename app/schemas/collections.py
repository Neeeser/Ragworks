"""Collection and prompt schema models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import StatsHistoryRange
from app.schemas.prompts import PromptTemplateRead, PromptTemplateUpdate

BucketGranularity = Literal["hour", "day"]


class CollectionBase(BaseModel):
    """Shared fields for collection payloads."""

    name: str
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PipelineNodeOverride(BaseModel):
    """Override configuration for a specific pipeline node."""

    node_id: str
    config: dict[str, Any] = Field(default_factory=dict)


class CollectionPipelineOverrides(BaseModel):
    """Per-collection pipeline overrides for creation.

    `ingestion` overrides clone the chosen ingest pipeline; `retrieval`
    overrides clone the primary tool pipeline.
    """

    ingestion: list[PipelineNodeOverride] = Field(default_factory=list)
    retrieval: list[PipelineNodeOverride] = Field(default_factory=list)


class CollectionCreate(CollectionBase):
    """Payload for creating a collection.

    `tool_pipeline_ids` bind in order (the first becomes the primary search
    tool); omitted, the user's default search pipeline is bound as primary.
    """

    ingest_pipeline_id: UUID | None = None
    tool_pipeline_ids: list[UUID] | None = None
    pipeline_overrides: CollectionPipelineOverrides | None = None


class CollectionUpdate(BaseModel):
    """Payload for updating collection fields.

    Tool bindings change through the collection tools endpoints;
    `ingest_pipeline_id` rebinds the single ingest pipeline here.
    """

    name: str | None = None
    description: str | None = None
    metadata: dict[str, Any] | None = None
    ingest_pipeline_id: UUID | None = None


class CollectionToolBindingRead(BaseModel):
    """One tool binding as embedded in collection reads (identity only).

    The full LLM-facing projection (name, schema, output kind) is served by
    `GET /api/collections/{id}/tools`.
    """

    id: UUID
    pipeline_id: UUID
    is_primary: bool
    enabled: bool
    position: int


class CollectionRead(DateTimeConfigMixin, CollectionBase):
    """Collection details returned to clients."""

    id: UUID
    user_id: UUID
    ingest_pipeline_id: UUID | None = None
    tools: list[CollectionToolBindingRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class CollectionDeleteResponse(BaseModel):
    """Response payload for collection deletion."""

    status: str = "deleted"


class CollectionPromptRead(PromptTemplateRead):
    """Prompt template data returned to clients."""


class CollectionPromptUpdate(PromptTemplateUpdate):
    """Payload for updating a collection prompt."""


class CollectionStatsRead(DateTimeConfigMixin, BaseModel):
    """Aggregate stats for a collection."""

    collection_id: UUID
    document_count: int
    chunk_count: int
    average_latency_ms: float | None = None
    last_used_at: datetime | None = None


class LatencyBucket(BaseModel):
    """Latency aggregates for one flow (ingestion or retrieval) in one bucket."""

    count: int = 0
    avg_ms: float | None = None
    p50_ms: float | None = None
    p95_ms: float | None = None
    max_ms: float | None = None


class CollectionStatsHistoryPoint(DateTimeConfigMixin, BaseModel):
    """One activity bucket (an hour or a day, per the requested range).

    Document/chunk totals are cumulative as of the end of the bucket;
    latency aggregates cover only events that occurred within it.
    """

    bucket_start: datetime
    document_total: int
    chunk_total: int
    ingestion: LatencyBucket = Field(default_factory=LatencyBucket)
    retrieval: LatencyBucket = Field(default_factory=LatencyBucket)


class CollectionStatsHistoryRead(BaseModel):
    """Bucketed activity history for a collection's trailing window."""

    collection_id: UUID
    range: StatsHistoryRange
    bucket: BucketGranularity
    points: list[CollectionStatsHistoryPoint]
