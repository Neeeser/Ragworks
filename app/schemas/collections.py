"""Collection and prompt schema models."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import BindingRole, IndexBackend, PipelineMarkerKind
from app.schemas.prompts import PromptTemplateRead, PromptTemplateUpdate

#: Series key for query events whose pipeline run was never recorded. Grouped
#: rather than dropped, so a chart's lines always sum to the collection's traffic.
UNATTRIBUTED_TOOL_KEY = "unattributed"


class CollectionBase(BaseModel):
    """Shared fields for collection payloads."""

    name: str
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CollectionCreate(CollectionBase):
    """Payload for creating a collection.

    `tool_pipeline_ids` bind in order (the first becomes the primary search
    tool); omitted, the user's default search pipeline is bound as primary.
    A collection chooses which pipelines run, never what they do — node
    configuration and the index each one uses live in the pipeline's graph.
    """

    ingest_pipeline_id: UUID | None = None
    tool_pipeline_ids: list[UUID] | None = None


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


class LatencySummary(BaseModel):
    """Latency aggregates for one flow over the whole requested domain.

    Computed from raw events, never folded from `LatencyBucket` values:
    percentiles do not average or max, so a domain p95 assembled from bucket
    p95s reports "the worst bucket's p95" under a name that claims otherwise.
    """

    count: int = 0
    avg_ms: float | None = None
    p50_ms: float | None = None
    p95_ms: float | None = None
    p99_ms: float | None = None
    max_ms: float | None = None


class ToolLatencySeries(BaseModel):
    """One retrieval series: a bound tool, or the unattributed remainder.

    `key` is what `CollectionStatsHistoryPoint.tools` is keyed by, so the chart
    joins buckets to series without re-deriving identity.
    """

    key: str
    pipeline_id: UUID | None = None
    name: str
    summary: LatencySummary = Field(default_factory=LatencySummary)


class LatencyEvent(DateTimeConfigMixin, BaseModel):
    """One measured operation, at the moment it happened.

    Buckets describe a window; an event describes a run. Charts draw these as
    dots so the variance a percentile summarizes stays visible — with a handful
    of runs a bucketed line is mostly gaps, and with thousands the dots read as
    the spread the median line sits inside.

    `key` names the tool series a query belongs to and is absent on ingestion
    events, which have only one series.
    """

    at: datetime
    duration_ms: float
    key: str | None = None


class PipelineMarker(DateTimeConfigMixin, BaseModel):
    """A pipeline change, placed on the timeline the charts share.

    `role` says which charts show it: `INGEST` markers explain document/chunk
    and ingestion-latency movement, `TOOL` markers belong to one retrieval
    series (`key` names it).
    """

    at: datetime
    pipeline_id: UUID
    key: str
    role: BindingRole
    kind: PipelineMarkerKind
    version: int | None = None
    label: str


class CollectionStatsHistoryPoint(DateTimeConfigMixin, BaseModel):
    """One activity bucket, `bucket_seconds` wide.

    Document/chunk totals are cumulative as of the end of the bucket; latency
    aggregates cover only events that occurred within it. `tools` holds one
    entry per series that saw traffic in this bucket — absent keys are gaps,
    not zeros, so a chart never draws a query that did not happen.
    """

    bucket_start: datetime
    document_total: int
    chunk_total: int
    ingestion: LatencyBucket = Field(default_factory=LatencyBucket)
    retrieval: LatencyBucket = Field(default_factory=LatencyBucket)
    """Every query in the bucket, whichever tool served it.

    Measured across all of them rather than folded from `tools`: percentiles
    do not combine, so a spread assembled from per-tool spreads describes the
    worst tool, not retrieval.
    """
    tools: dict[str, LatencyBucket] = Field(default_factory=dict)


class CollectionStatsHistoryRead(DateTimeConfigMixin, BaseModel):
    """Bucketed activity history over a resolved domain.

    The domain defaults to the collection's lifetime and narrows to an
    explicit `start`/`end`; both are echoed back with the bucket width the
    server chose, so the client never re-derives the axis it was given.
    """

    collection_id: UUID
    start: datetime
    end: datetime
    bucket_seconds: int
    points: list[CollectionStatsHistoryPoint]
    tools: list[ToolLatencySeries] = Field(default_factory=list)
    ingestion_summary: LatencySummary = Field(default_factory=LatencySummary)
    retrieval_summary: LatencySummary = Field(default_factory=LatencySummary)
    markers: list[PipelineMarker] = Field(default_factory=list)
    ingestion_events: list[LatencyEvent] = Field(default_factory=list)
    query_events: list[LatencyEvent] = Field(default_factory=list)
    events_sampled: bool = False
    """True when an event list was downsampled to fit its cap.

    The bands and lines still summarize every row — only the dots thin out —
    so a reader who sees fewer dots than the count claims is told why rather
    than left to conclude events went missing.
    """


class CollectionIndexTarget(BaseModel):
    """An index a bound pipeline names inside its own graph.

    Reported so a collection can always answer "where does my data live",
    including the ordinary case where no slot is exposed at all. It carries
    no selection because there is nothing to select here: the choice belongs
    to the pipeline that names it, and the link is to that pipeline.
    """

    name: str
    backend: IndexBackend
    vector_type: str
    dimension: int | None = None
    pipelines: list[str] = Field(default_factory=list)


class CollectionIndexesRead(BaseModel):
    """Every index a collection's bound pipelines name."""

    targets: list[CollectionIndexTarget] = Field(default_factory=list)
