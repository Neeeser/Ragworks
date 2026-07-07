"""Telemetry event table: lightweight, aggregatable activity facts.

One append-only table for every event type — hooking a new event into
telemetry never needs a migration. Heavyweight operational records that
power features (``IngestionEvent``/``QueryEvent`` behind the trace UI) are
a different concern and keep their own domain tables.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, DateTime, Index, String
from sqlmodel import Field, SQLModel

from app.utils.time import utc_now


class TelemetryEventRow(SQLModel, table=True):
    """A single recorded telemetry event (dotted type + JSON payload)."""

    __tablename__ = "telemetry_events"
    __table_args__ = (
        Index("ix_telemetry_events_type_user_created", "event_type", "user_id", "created_at"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    event_type: str = Field(sa_column=Column(String, nullable=False, index=True))
    user_id: UUID | None = Field(default=None, foreign_key="users.id", nullable=True, index=True)
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime, nullable=False, index=True),
    )
