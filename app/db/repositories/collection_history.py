"""Collection activity domain, growth aggregates, and pipeline-change markers.

Every aggregate backing the Overview charts is bucketed with Postgres
`date_bin` anchored at the domain start, so an arbitrary bucket width (not
just `date_trunc`'s fixed names) lines every series up on the same grid.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import SQLColumnExpression, func, literal
from sqlalchemy import select as sa_select
from sqlmodel import col

from app.db import models
from app.db.repositories.base import Repository
from app.schemas.enums import BindingRole, PipelineMarkerKind

#: Hard ceiling on buckets materialized for one request. The service picks the
#: width from a ladder that keeps real domains far below this; the cap only
#: stops a pathological domain from building an unbounded list.
MAX_BUCKETS = 512


@dataclass(frozen=True)
class HistoryDomain:
    """A resolved chart domain: `[start, end)` at a fixed bucket width.

    Datetimes are naive UTC — timestamp columns are naive UTC, and `date_bin`
    keys must compare equal to the bucket starts built here.
    """

    start: datetime
    end: datetime
    bucket_seconds: int

    @property
    def step(self) -> timedelta:
        """The bucket width as a timedelta."""
        return timedelta(seconds=self.bucket_seconds)

    def bucket_starts(self) -> list[datetime]:
        """Every bucket start in the domain, oldest first."""
        starts: list[datetime] = []
        cursor = self.start
        while cursor < self.end and len(starts) < MAX_BUCKETS:
            starts.append(cursor)
            cursor += self.step
        return starts


@dataclass(frozen=True)
class PipelineChangeMarker:
    """A pipeline change that falls inside the domain."""

    at: datetime
    pipeline_id: UUID
    role: BindingRole
    kind: PipelineMarkerKind
    label: str
    version: int | None = None


@dataclass(frozen=True)
class BoundTool:
    """A pipeline bound to a collection in the tool role."""

    pipeline_id: UUID
    name: str


def optional_float(value: Any) -> float | None:
    """Coerce an aggregate cell to float, preserving SQL NULL as None."""
    return None if value is None else float(value)


def bucket_expr(
    created_at: SQLColumnExpression[Any],
    domain: HistoryDomain,
) -> SQLColumnExpression[Any]:
    """Bucket key for a timestamp column, aligned to the domain start.

    `make_interval` binds the width as a parameter rather than splicing an
    interval literal into SQL.
    """
    width = func.make_interval(0, 0, 0, 0, 0, 0, domain.bucket_seconds)
    return func.date_bin(width, created_at, literal(domain.start))


class CollectionHistoryRepository(Repository):
    """Domain anchoring, document growth, and pipeline-change markers."""

    def first_activity_at(self, user_id: UUID, collection_id: UUID) -> datetime | None:
        """Earliest document or query timestamp, or None for an idle collection."""
        first_document = self.session.execute(
            sa_select(func.min(col(models.Document.created_at))).where(
                col(models.Document.user_id) == user_id,
                col(models.Document.collection_id) == collection_id,
            )
        ).one()[0]
        first_query = self.session.execute(
            sa_select(func.min(col(models.QueryEvent.created_at))).where(
                col(models.QueryEvent.user_id) == user_id,
                col(models.QueryEvent.collection_id) == collection_id,
            )
        ).one()[0]
        candidates = [value for value in (first_document, first_query) if value is not None]
        return min(candidates) if candidates else None

    def document_growth(
        self,
        user_id: UUID,
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> tuple[int, int, dict[datetime, tuple[int, int]]]:
        """Return the pre-domain (docs, chunks) baseline plus per-bucket additions."""
        owned = (
            col(models.Document.user_id) == user_id,
            col(models.Document.collection_id) == collection_id,
        )
        baseline = self.session.execute(
            sa_select(
                func.count(col(models.Document.id)),  # pylint: disable=not-callable
                func.coalesce(func.sum(col(models.Document.num_chunks)), 0),
            ).where(*owned, col(models.Document.created_at) < domain.start)
        ).one()

        bucket = bucket_expr(col(models.Document.created_at), domain)
        rows = self.session.execute(
            sa_select(
                bucket,
                func.count(col(models.Document.id)),  # pylint: disable=not-callable
                func.coalesce(func.sum(col(models.Document.num_chunks)), 0),
            )
            .where(
                *owned,
                col(models.Document.created_at) >= domain.start,
                col(models.Document.created_at) < domain.end,
            )
            .group_by(bucket)
        ).all()
        return (
            int(baseline[0]),
            int(baseline[1]),
            {row[0]: (int(row[1]), int(row[2])) for row in rows},
        )

    def bound_tools(self, collection_id: UUID) -> list[BoundTool]:
        """Pipelines bound to the collection in the tool role, in listing order."""
        rows = self.session.execute(
            sa_select(
                col(models.CollectionPipelineBinding.pipeline_id),
                col(models.Pipeline.name),
            )
            .join(
                models.Pipeline,
                col(models.Pipeline.id) == col(models.CollectionPipelineBinding.pipeline_id),
            )
            .where(
                col(models.CollectionPipelineBinding.collection_id) == collection_id,
                col(models.CollectionPipelineBinding.role) == BindingRole.TOOL,
            )
            .order_by(col(models.CollectionPipelineBinding.position))
        ).all()
        return [BoundTool(pipeline_id=row[0], name=str(row[1])) for row in rows]

    def markers(
        self,
        collection_id: UUID,
        domain: HistoryDomain,
    ) -> list[PipelineChangeMarker]:
        """Pipeline versions saved and tools bound within the domain.

        Unbinding is absent by construction: bindings are hard-deleted, so a
        removed tool leaves no timestamp to plot.
        """
        bindings = self.session.execute(
            sa_select(
                col(models.CollectionPipelineBinding.pipeline_id),
                col(models.CollectionPipelineBinding.role),
                col(models.CollectionPipelineBinding.created_at),
                col(models.Pipeline.name),
            )
            .join(
                models.Pipeline,
                col(models.Pipeline.id) == col(models.CollectionPipelineBinding.pipeline_id),
            )
            .where(col(models.CollectionPipelineBinding.collection_id) == collection_id)
        ).all()
        if not bindings:
            return []

        roles = {row[0]: BindingRole(row[1]) for row in bindings}
        names = {row[0]: str(row[3]) for row in bindings}
        found = [
            PipelineChangeMarker(
                at=row[2],
                pipeline_id=row[0],
                role=BindingRole(row[1]),
                kind=PipelineMarkerKind.TOOL_ADDED,
                label=f"{row[3]} bound as a tool",
            )
            for row in bindings
            if BindingRole(row[1]) == BindingRole.TOOL and domain.start <= row[2] < domain.end
        ]

        version_rows = self.session.execute(
            sa_select(
                col(models.PipelineVersion.pipeline_id),
                col(models.PipelineVersion.version),
                col(models.PipelineVersion.created_at),
            ).where(
                col(models.PipelineVersion.pipeline_id).in_(list(roles)),
                col(models.PipelineVersion.created_at) >= domain.start,
                col(models.PipelineVersion.created_at) < domain.end,
            )
        ).all()
        found.extend(
            PipelineChangeMarker(
                at=row[2],
                pipeline_id=row[0],
                role=roles[row[0]],
                kind=PipelineMarkerKind.VERSION,
                label=f"{names[row[0]]} v{row[1]}",
                version=int(row[1]),
            )
            for row in version_rows
        )
        return sorted(found, key=lambda marker: marker.at)
