"""Collection activity history: domain resolution and chart assembly.

The Overview charts share one domain. It defaults to the collection's whole
life and narrows to an explicit span when the user brushes a range; either way
the server picks the bucket width, so the client never invents an axis.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.db.repositories import (
    CollectionHistoryRepository,
    CollectionLatencyRepository,
    HistoryDomain,
    LatencyBucketStats,
    LatencyEventRow,
    LatencySummaryStats,
    PipelineChangeMarker,
)
from app.schemas.collections import (
    UNATTRIBUTED_TOOL_KEY,
    CollectionStatsHistoryPoint,
    CollectionStatsHistoryRead,
    LatencyBucket,
    LatencyEvent,
    LatencySummary,
    PipelineMarker,
    ToolLatencySeries,
)
from app.services.errors import InvalidInputError
from app.utils.time import utc_now

#: Bucket widths in seconds, finest first. Steps stay within ~3.5x of each
#: other so the chosen width never leaves a span with too few buckets to read
#: as a curve. `date_bin` cannot use month-based intervals, so the coarsest
#: step is a fixed 30 days rather than a calendar month.
BUCKET_LADDER: tuple[int, ...] = (
    60,  # 1m
    300,  # 5m
    900,  # 15m
    1800,  # 30m
    3600,  # 1h
    7200,  # 2h
    21600,  # 6h
    43200,  # 12h
    86400,  # 1d
    172800,  # 2d
    604800,  # 1w
    1209600,  # 2w
    2592000,  # 30d
)

#: Upper bound on buckets per chart. The ladder step is the finest one that
#: keeps a span at or under this, so resolution always tracks the span.
TARGET_MAX_BUCKETS = 60

_MIN_SPAN = timedelta(seconds=1)

#: Series label for query events whose pipeline run was never recorded.
_UNATTRIBUTED_LABEL = "Unattributed"


def resolve_bucket_seconds(span: timedelta) -> int:
    """Pick the finest ladder width that keeps `span` within the bucket ceiling."""
    seconds = max(span.total_seconds(), _MIN_SPAN.total_seconds())
    for step in BUCKET_LADDER:
        if seconds / step <= TARGET_MAX_BUCKETS:
            return step
    return BUCKET_LADDER[-1]


def _as_naive_utc(value: datetime) -> datetime:
    """Normalize to the naive UTC form the timestamp columns store."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def resolve_domain(
    *,
    collection_created_at: datetime,
    first_activity_at: datetime | None,
    now: datetime | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> HistoryDomain:
    """Resolve the chart domain: an explicit brushed span, else the lifetime.

    The lifetime domain starts one bucket *before* the first activity. Without
    that lead-in the series opens at the post-ingest total and the first
    ingest — usually the only thing that ever happened — is invisible.
    """
    moment = _as_naive_utc(now or utc_now())
    if start is not None and end is not None:
        span_start, span_end = _as_naive_utc(start), _as_naive_utc(end)
        if span_end <= span_start:
            raise InvalidInputError("History range end must be after its start")
        return HistoryDomain(span_start, span_end, resolve_bucket_seconds(span_end - span_start))

    anchor = min(_as_naive_utc(first_activity_at or collection_created_at), moment)
    bucket_seconds = resolve_bucket_seconds(max(moment - anchor, _MIN_SPAN))
    return HistoryDomain(anchor - timedelta(seconds=bucket_seconds), moment, bucket_seconds)


@dataclass(frozen=True)
class _BucketSeries:
    """Every per-bucket latency series a point is assembled from."""

    ingestion: dict[datetime, LatencyBucketStats]
    retrieval: dict[datetime, LatencyBucketStats]
    tools: dict[str, dict[datetime, LatencyBucketStats]]


def _to_bucket(stats: LatencyBucketStats) -> LatencyBucket:
    """Map a repository bucket row onto its wire model."""
    return LatencyBucket(
        count=stats.count,
        avg_ms=stats.avg_ms,
        p50_ms=stats.p50_ms,
        p95_ms=stats.p95_ms,
        max_ms=stats.max_ms,
    )


def _to_summary(stats: LatencySummaryStats) -> LatencySummary:
    """Map a repository summary row onto its wire model."""
    return LatencySummary(
        count=stats.count,
        avg_ms=stats.avg_ms,
        p50_ms=stats.p50_ms,
        p95_ms=stats.p95_ms,
        p99_ms=stats.p99_ms,
        max_ms=stats.max_ms,
    )


def _to_event(row: LatencyEventRow) -> LatencyEvent:
    """Map a repository event row onto its wire model."""
    return LatencyEvent(at=row.at, duration_ms=row.duration_ms, key=row.key)


def _to_marker(marker: PipelineChangeMarker) -> PipelineMarker:
    """Map a repository marker onto its wire model, keyed to its series."""
    return PipelineMarker(
        at=marker.at,
        pipeline_id=marker.pipeline_id,
        key=str(marker.pipeline_id),
        role=marker.role,
        kind=marker.kind,
        version=marker.version,
        label=marker.label,
    )


class CollectionHistoryService:
    """Assembles the bucketed history the Overview charts render from."""

    def __init__(
        self,
        history: CollectionHistoryRepository,
        latency: CollectionLatencyRepository,
    ) -> None:
        self._history = history
        self._latency = latency

    def history_for(
        self,
        *,
        user_id: UUID,
        collection_id: UUID,
        collection_created_at: datetime,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> CollectionStatsHistoryRead:
        """Return the collection's bucketed activity over the resolved domain."""
        domain = resolve_domain(
            collection_created_at=collection_created_at,
            first_activity_at=self._history.first_activity_at(user_id, collection_id),
            start=start,
            end=end,
        )
        doc_total, chunk_total, growth = self._history.document_growth(
            user_id, collection_id, domain
        )
        series = _BucketSeries(
            ingestion=self._latency.ingestion_buckets(collection_id, domain),
            retrieval=self._latency.retrieval_buckets(user_id, collection_id, domain),
            tools=self._latency.tool_buckets(user_id, collection_id, domain),
        )
        tools = self._tool_series(collection_id, series.tools, user_id, domain)
        ingestion_summary = _to_summary(self._latency.ingestion_summary(collection_id, domain))
        retrieval_summary = _to_summary(
            self._latency.retrieval_summary(user_id, collection_id, domain)
        )

        ingestion_events = self._latency.ingestion_events(collection_id, domain)
        query_events = self._latency.query_events(user_id, collection_id, domain)
        recorded = ingestion_summary.count + retrieval_summary.count

        return CollectionStatsHistoryRead(
            collection_id=collection_id,
            start=domain.start,
            end=domain.end,
            bucket_seconds=domain.bucket_seconds,
            points=self._points(domain, (doc_total, chunk_total), growth, series),
            tools=tools,
            ingestion_summary=ingestion_summary,
            retrieval_summary=retrieval_summary,
            markers=[_to_marker(marker) for marker in self._history.markers(collection_id, domain)],
            ingestion_events=[_to_event(row) for row in ingestion_events],
            query_events=[_to_event(row) for row in query_events],
            events_sampled=len(ingestion_events) + len(query_events) < recorded,
        )

    @staticmethod
    def _points(
        domain: HistoryDomain,
        baseline: tuple[int, int],
        growth: dict[datetime, tuple[int, int]],
        series: _BucketSeries,
    ) -> list[CollectionStatsHistoryPoint]:
        """Fold per-bucket additions into a continuous cumulative series.

        Every bucket gets a point so the axis is continuous, but a bucket with
        no queries carries no `tools` entry — an absent key is a gap, not a
        zero-latency query that never happened.
        """
        doc_total, chunk_total = baseline
        points: list[CollectionStatsHistoryPoint] = []
        for bucket in domain.bucket_starts():
            added_docs, added_chunks = growth.get(bucket, (0, 0))
            doc_total += added_docs
            chunk_total += added_chunks
            tools = {
                key: _to_bucket(entries[bucket])
                for key, entries in series.tools.items()
                if bucket in entries
            }
            points.append(
                CollectionStatsHistoryPoint(
                    bucket_start=bucket,
                    document_total=doc_total,
                    chunk_total=chunk_total,
                    ingestion=_to_bucket(series.ingestion.get(bucket, LatencyBucketStats())),
                    retrieval=_to_bucket(series.retrieval.get(bucket, LatencyBucketStats())),
                    tools=tools,
                )
            )
        return points

    def _tool_series(
        self,
        collection_id: UUID,
        tool_buckets: dict[str, dict[datetime, LatencyBucketStats]],
        user_id: UUID,
        domain: HistoryDomain,
    ) -> list[ToolLatencySeries]:
        """One series per bound tool, plus any key that only history knows about.

        A tool unbound after serving queries still has buckets in the domain,
        so its series is kept (named from its pipeline id) rather than dropped
        — otherwise the chart would silently lose traffic that happened.
        """
        summaries = self._latency.tool_summaries(user_id, collection_id, domain)
        bound = self._history.bound_tools(collection_id)
        series = [
            ToolLatencySeries(
                key=str(tool.pipeline_id),
                pipeline_id=tool.pipeline_id,
                name=tool.name,
                summary=_to_summary(summaries.get(str(tool.pipeline_id), LatencySummaryStats())),
            )
            for tool in bound
        ]

        known = {entry.key for entry in series}
        for key in sorted(set(tool_buckets) | set(summaries)):
            if key in known:
                continue
            unattributed = key == UNATTRIBUTED_TOOL_KEY
            series.append(
                ToolLatencySeries(
                    key=key,
                    pipeline_id=None if unattributed else UUID(key),
                    name=_UNATTRIBUTED_LABEL if unattributed else "Unbound tool",
                    summary=_to_summary(summaries.get(key, LatencySummaryStats())),
                )
            )
        return series
