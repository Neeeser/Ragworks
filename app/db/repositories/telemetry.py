"""Repository for telemetry event rows: appends and retention purges.

Aggregation queries for the admin usage dashboard live here too as they are
added — dashboards never query the table directly.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlmodel import col
from sqlmodel import select as sm_select

from app.db import models
from app.db.repositories.base import Repository


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

    def purge_older_than(self, cutoff: datetime) -> int:
        """Delete events created before ``cutoff``; return how many went."""
        expired = col(models.TelemetryEventRow.created_at) < cutoff
        count_statement = (
            select(func.count()).select_from(models.TelemetryEventRow).where(expired)
        )
        count = self.session.scalar(count_statement) or 0
        if count:
            self.session.execute(sa_delete(models.TelemetryEventRow).where(expired))
        return int(count)
