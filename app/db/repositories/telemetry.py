"""Repository for telemetry event rows: appends and retention purges.

Aggregation queries for the admin usage dashboard live here too as they are
added — dashboards never query the table directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlmodel import col
from sqlmodel import select as sm_select

from app.db import models
from app.db.repositories.base import Repository


@dataclass(frozen=True)
class ChatUsageByUser:
    """Per-user chat usage aggregate over a window."""

    user_id: UUID
    turns: int
    total_tokens: int
    cost: float
    last_active: datetime


@dataclass(frozen=True)
class DailyUsagePoint:
    """One day's chat usage across all users."""

    day: datetime
    turns: int
    total_tokens: int


class TelemetryRepository(Repository):
    """Data access for the append-only telemetry_events table."""

    def add(
        self,
        *,
        event_type: str,
        user_id: UUID | None,
        payload: dict[str, object],
    ) -> models.TelemetryEventRow:
        """Append one event row (flushed, not committed)."""
        row = models.TelemetryEventRow(
            event_type=event_type,
            user_id=user_id,
            payload=dict(payload),
        )
        return self._add(row)

    def list_by_type(self, event_type: str) -> list[models.TelemetryEventRow]:
        """Return every event of one type, oldest first."""
        statement = (
            sm_select(models.TelemetryEventRow)
            .where(models.TelemetryEventRow.event_type == event_type)
            .order_by(col(models.TelemetryEventRow.created_at).asc())
        )
        return list(self.session.exec(statement).all())

    def chat_usage_by_user(self, since: datetime) -> list[ChatUsageByUser]:
        """Aggregate chat.turn_completed events per user since ``since``."""
        row = models.TelemetryEventRow
        payload = row.payload
        statement = (
            select(
                col(row.user_id),
                func.count().label("turns"),
                func.coalesce(func.sum(payload["total_tokens"].as_integer()), 0),
                func.coalesce(func.sum(payload["cost"].as_float()), 0.0),
                func.max(col(row.created_at)),
            )
            .where(col(row.event_type) == "chat.turn_completed")
            .where(col(row.created_at) >= since)
            .where(col(row.user_id).is_not(None))
            .group_by(col(row.user_id))
        )
        return [
            ChatUsageByUser(
                user_id=user_id,
                turns=int(turns),
                total_tokens=int(tokens),
                cost=float(cost),
                last_active=last_active,
            )
            for user_id, turns, tokens, cost, last_active in self.session.execute(statement)
        ]

    def daily_chat_usage(self, since: datetime) -> list[DailyUsagePoint]:
        """Aggregate chat.turn_completed events per day since ``since``."""
        row = models.TelemetryEventRow
        payload = row.payload
        day = func.date_trunc("day", col(row.created_at))
        statement = (
            select(
                day.label("day"),
                func.count().label("turns"),
                func.coalesce(func.sum(payload["total_tokens"].as_integer()), 0),
            )
            .where(col(row.event_type) == "chat.turn_completed")
            .where(col(row.created_at) >= since)
            .group_by(day)
            .order_by(day)
        )
        return [
            DailyUsagePoint(day=point_day, turns=int(turns), total_tokens=int(tokens))
            for point_day, turns, tokens in self.session.execute(statement)
        ]

    def event_counts(self, since: datetime) -> dict[str, int]:
        """Return per-event-type counts since ``since`` (dashboard headline)."""
        row = models.TelemetryEventRow
        statement = (
            select(col(row.event_type), func.count())
            .where(col(row.created_at) >= since)
            .group_by(col(row.event_type))
        )
        return {event_type: int(count) for event_type, count in self.session.execute(statement)}

    def purge_older_than(self, cutoff: datetime) -> int:
        """Delete events created before ``cutoff``; return how many went."""
        expired = col(models.TelemetryEventRow.created_at) < cutoff
        count_statement = select(func.count()).select_from(models.TelemetryEventRow).where(expired)
        count = self.session.scalar(count_statement) or 0
        if count:
            self.session.execute(sa_delete(models.TelemetryEventRow).where(expired))
        return int(count)
