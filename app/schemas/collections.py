"""Collection and prompt schema models."""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin
from app.schemas.prompts import PromptTemplateRead, PromptTemplateUpdate


class CollectionBase(BaseModel):
    """Shared fields for collection payloads."""

    name: str
    description: str | None = None
    ingestion_pipeline_id: UUID | None = None
    retrieval_pipeline_id: UUID | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class PipelineNodeOverride(BaseModel):
    """Override configuration for a specific pipeline node."""

    node_id: str
    config: dict[str, Any] = Field(default_factory=dict)


class CollectionPipelineOverrides(BaseModel):
    """Per-collection pipeline overrides for creation."""

    ingestion: list[PipelineNodeOverride] = Field(default_factory=list)
    retrieval: list[PipelineNodeOverride] = Field(default_factory=list)


class CollectionCreate(CollectionBase):
    """Payload for creating a collection."""

    pipeline_overrides: CollectionPipelineOverrides | None = None


class CollectionUpdate(BaseModel):
    """Payload for updating collection fields."""

    name: str | None = None
    description: str | None = None
    metadata: dict[str, Any] | None = None
    ingestion_pipeline_id: UUID | None = None
    retrieval_pipeline_id: UUID | None = None


class CollectionRead(DateTimeConfigMixin, CollectionBase):
    """Collection details returned to clients."""

    id: UUID
    user_id: UUID
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
    """Latency aggregates for one flow (ingestion or retrieval) in one day bucket."""

    count: int = 0
    avg_ms: float | None = None
    p50_ms: float | None = None
    p95_ms: float | None = None
    max_ms: float | None = None


class CollectionStatsHistoryPoint(BaseModel):
    """One daily bucket of collection activity.

    Document/chunk totals are cumulative as of the end of the bucket's day;
    latency aggregates cover only events that occurred within the day.
    """

    date: date_type
    document_total: int
    chunk_total: int
    ingestion: LatencyBucket = Field(default_factory=LatencyBucket)
    retrieval: LatencyBucket = Field(default_factory=LatencyBucket)


class CollectionStatsHistoryRead(BaseModel):
    """Daily activity history for a collection."""

    collection_id: UUID
    days: int
    points: list[CollectionStatsHistoryPoint]
