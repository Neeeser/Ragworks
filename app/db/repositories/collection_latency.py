"""Latency aggregates for a collection's ingestion runs and tool queries.

Bucket series feed the charts; domain summaries feed the per-tool stats table.
Summaries are separate queries on purpose — percentiles neither average nor
max, so a domain p95 folded from bucket p95s reports "the worst bucket's p95"
under a name that claims otherwise.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Select, SQLColumnExpression, String, cast, func, literal
from sqlalchemy import select as sa_select
from sqlmodel import col

from app.db import models
from app.db.repositories.base import Repository
from app.db.repositories.collection_history import HistoryDomain, bucket_expr, optional_float
from app.schemas.collections import UNATTRIBUTED_TOOL_KEY


@dataclass(frozen=True)
class LatencyBucketStats:
    """Latency aggregates for one series within one bucket."""

    count: int = 0
    avg_ms: float | None = None
    p50_ms: float | None = None
    p95_ms: float | None = None
    max_ms: float | None = None


@dataclass(frozen=True)
class LatencySummaryStats:
    """Latency aggregates for one series across the whole domain."""

    count: int = 0
    avg_ms: float | None = None
    p50_ms: float | None = None
    p95_ms: float | None = None
    p99_ms: float | None = None
    max_ms: float | None = None


def _run_duration_ms() -> SQLColumnExpression[Any]:
    """Milliseconds a pipeline run took, as a SQL expression."""
    return (
        func.extract(
            "epoch",
            col(models.PipelineRun.completed_at) - col(models.PipelineRun.started_at),
        )
        * 1000.0
    )


def _bucket_stats(row: Sequence[Any], offset: int) -> LatencyBucketStats:
    """Read count/avg/p50/p95/max from `row` starting at `offset`."""
    return LatencyBucketStats(
        count=int(row[offset]),
        avg_ms=optional_float(row[offset + 1]),
        p50_ms=optional_float(row[offset + 2]),
        p95_ms=optional_float(row[offset + 3]),
        max_ms=optional_float(row[offset + 4]),
    )


class CollectionLatencyRepository(Repository):
    """Per-bucket and domain-wide latency reads for one collection."""

    def ingestion_buckets(
        self,
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> dict[datetime, LatencyBucketStats]:
        """Per-bucket ingest-run latency for the collection."""
        bucket = bucket_expr(col(models.PipelineRun.created_at), domain)
        rows = self.session.execute(
            sa_select(bucket, *self._bucket_aggregates(_run_duration_ms()))
            .where(*self._ingest_clauses(collection_id, domain))
            .group_by(bucket)
        ).all()
        return {row[0]: _bucket_stats(row, 1) for row in rows}

    def ingestion_summary(
        self,
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> LatencySummaryStats:
        """Domain-wide ingest-run latency summary."""
        row = self.session.execute(
            sa_select(*self._summary_aggregates(_run_duration_ms())).where(
                *self._ingest_clauses(collection_id, domain)
            )
        ).one()
        return self._summary_stats(row)

    def tool_buckets(
        self,
        user_id: UUID,
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> dict[str, dict[datetime, LatencyBucketStats]]:
        """Per-bucket query latency, split by the tool pipeline that served it."""
        bucket = bucket_expr(col(models.QueryEvent.created_at), domain)
        series = self._tool_key_expr()
        latency = col(models.QueryEvent.latency_ms)
        rows = self.session.execute(
            self._query_events(user_id, collection_id, domain)
            .add_columns(series, bucket, *self._bucket_aggregates(latency))
            .group_by(series, bucket)
        ).all()

        buckets: dict[str, dict[datetime, LatencyBucketStats]] = {}
        for row in rows:
            buckets.setdefault(str(row[0]), {})[row[1]] = _bucket_stats(row, 2)
        return buckets

    def tool_summaries(
        self,
        user_id: UUID,
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> dict[str, LatencySummaryStats]:
        """Domain-wide query-latency summary per tool pipeline."""
        series = self._tool_key_expr()
        latency = col(models.QueryEvent.latency_ms)
        rows = self.session.execute(
            self._query_events(user_id, collection_id, domain)
            .add_columns(series, *self._summary_aggregates(latency))
            .group_by(series)
        ).all()
        return {str(row[0]): self._summary_stats(row[1:]) for row in rows}

    @staticmethod
    def _bucket_aggregates(value: SQLColumnExpression[Any]) -> tuple[Any, ...]:
        """The count/avg/p50/p95/max column set for a bucketed series."""
        return (
            func.count(),  # pylint: disable=not-callable
            func.avg(value),
            func.percentile_cont(0.5).within_group(value),
            func.percentile_cont(0.95).within_group(value),
            func.max(value),
        )

    @staticmethod
    def _summary_aggregates(value: SQLColumnExpression[Any]) -> tuple[Any, ...]:
        """The count/avg/p50/p95/p99/max column set for a domain summary."""
        return (
            func.count(),  # pylint: disable=not-callable
            func.avg(value),
            func.percentile_cont(0.5).within_group(value),
            func.percentile_cont(0.95).within_group(value),
            func.percentile_cont(0.99).within_group(value),
            func.max(value),
        )

    @staticmethod
    def _summary_stats(row: Sequence[Any]) -> LatencySummaryStats:
        """Read a summary row produced by `_summary_aggregates`."""
        return LatencySummaryStats(
            count=int(row[0]),
            avg_ms=optional_float(row[1]),
            p50_ms=optional_float(row[2]),
            p95_ms=optional_float(row[3]),
            p99_ms=optional_float(row[4]),
            max_ms=optional_float(row[5]),
        )

    @staticmethod
    def _tool_key_expr() -> SQLColumnExpression[Any]:
        """Series key for a query event: its tool pipeline, or the unattributed bucket."""
        return func.coalesce(
            cast(col(models.PipelineRun.pipeline_id), String),
            literal(UNATTRIBUTED_TOOL_KEY),
        )

    @staticmethod
    def _ingest_clauses(
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> tuple[ColumnElement[bool], ...]:
        """Restrict pipeline runs to this collection's completed ingest runs in the domain."""
        return (
            col(models.PipelineRun.collection_id) == collection_id,
            col(models.PipelineRun.trigger) == models.BindingRole.INGEST,
            col(models.PipelineRun.status) == models.PipelineRunStatus.COMPLETED,
            col(models.PipelineRun.completed_at).is_not(None),
            col(models.PipelineRun.created_at) >= domain.start,
            col(models.PipelineRun.created_at) < domain.end,
        )

    @staticmethod
    def _query_events(
        user_id: UUID,
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> Select[Any]:
        """Query events in the domain, outer-joined to the run that served them.

        The join is outer so events whose run was never recorded still reach
        the unattributed series instead of vanishing from the totals.
        """
        return (
            sa_select()
            .select_from(models.QueryEvent)
            .outerjoin(
                models.PipelineRun,
                col(models.PipelineRun.id) == col(models.QueryEvent.pipeline_run_id),
            )
            .where(
                col(models.QueryEvent.user_id) == user_id,
                col(models.QueryEvent.collection_id) == collection_id,
                col(models.QueryEvent.created_at) >= domain.start,
                col(models.QueryEvent.created_at) < domain.end,
            )
        )
