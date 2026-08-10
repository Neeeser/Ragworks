"""Read side of the usage ledger: summaries and the drill-down event list.

Every aggregate comes back from SQL already grouped (`UsageEventRepository`);
this layer only maps repository rows onto the wire contract and owns the two
rules a caller must not be able to bypass — the default range, and that a
range scoped to one user is never also grouped by user.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlmodel import Session

from app.db import models
from app.db.repositories import UsageEventRepository
from app.schemas.enums import UsageBucket, UsageGroupBy, UsageKind, UsageSurface, UsageUnit
from app.schemas.usage import (
    UsageEventPage,
    UsageEventRead,
    UsageGroupRow,
    UsageQuery,
    UsageSeriesPoint,
    UsageSummaryRead,
    UsageUnitTotal,
)
from app.services.errors import InvalidInputError

DEFAULT_RANGE_DAYS = 30


def resolve_range(start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    """Fill in the default range and reject one that runs backwards.

    The default is the last 30 days ending now, so a dashboard that asks for
    nothing gets the same window every other caller means by "recent".
    """
    resolved_end = end or datetime.now(UTC)
    resolved_start = start or resolved_end - timedelta(days=DEFAULT_RANGE_DAYS)
    if resolved_start >= resolved_end:
        raise InvalidInputError("start must be earlier than end")
    return resolved_start, resolved_end


class UsageReadService:
    """Serves usage summaries and event pages from the ledger."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a session."""
        self.repository = UsageEventRepository(session)

    def summary(
        self,
        query: UsageQuery,
        *,
        group_by: UsageGroupBy,
        bucket: UsageBucket,
    ) -> UsageSummaryRead:
        """Aggregate one range into group rows, a time series, and totals."""
        if group_by is UsageGroupBy.USER and query.user_id is not None:
            raise InvalidInputError("group_by=user needs a range covering more than one user")
        return UsageSummaryRead(
            start=query.start,
            end=query.end,
            group_by=group_by,
            bucket=bucket,
            groups=[
                UsageGroupRow(
                    key=row.key,
                    label=row.label,
                    unit=UsageUnit(row.unit),
                    quantity=row.quantity,
                    cost_usd=row.cost_usd,
                    event_count=row.event_count,
                )
                for row in self.repository.grouped_totals(query, group_by)
            ],
            series=[
                UsageSeriesPoint(
                    bucket_start=point.bucket_start,
                    kind=UsageKind(point.kind),
                    unit=UsageUnit(point.unit),
                    quantity=point.quantity,
                    cost_usd=point.cost_usd,
                )
                for point in self.repository.bucketed_series(query, bucket)
            ],
            totals=[
                UsageUnitTotal(
                    unit=UsageUnit(total.unit),
                    quantity=total.quantity,
                    cost_usd=total.cost_usd,
                    event_count=total.event_count,
                )
                for total in self.repository.unit_totals(query)
            ],
            total_cost_usd=self.repository.total_cost(query),
        )

    def events(self, query: UsageQuery, *, limit: int, offset: int) -> UsageEventPage:
        """Return one page of matching ledger rows, newest first."""
        rows = self.repository.list_events(query, limit=limit, offset=offset)
        return UsageEventPage(
            events=[_to_read(row) for row in rows],
            total=self.repository.count_events(query),
            limit=limit,
            offset=offset,
        )


def _to_read(row: models.UsageEvent) -> UsageEventRead:
    """Map a ledger row onto its wire shape."""
    return UsageEventRead(
        id=row.id,
        created_at=row.created_at,
        user_id=row.user_id,
        connection_id=row.connection_id,
        provider=row.provider,
        model=row.model,
        kind=UsageKind(row.kind),
        surface=UsageSurface(row.surface),
        context_type=row.context_type,
        context_id=row.context_id,
        quantity=row.quantity,
        unit=UsageUnit(row.unit),
        prompt_tokens=row.prompt_tokens,
        completion_tokens=row.completion_tokens,
        cost_usd=row.cost_usd,
    )
