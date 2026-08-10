"""The instance-wide usage ledger table.

One append-only row per provider call that reported a real quantity. The
ledger is written at the provider boundary and never read by the code that
writes it, so a recording failure can be swallowed without a caller ever
depending on the row.

A call whose provider publishes no usage is absent from the ledger rather
than present with a zero — a zero would be indistinguishable from a free
call and would silently understate every total built over it.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import Column, Float, Index, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class UsageEvent(SQLModel, TimestampMixin, table=True):
    """One provider call's reported spend, attributed to a user and surface."""

    __tablename__ = "usage_events"
    __table_args__ = (Index("ix_usage_events_user_created", "user_id", "created_at"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    # No foreign key: history outlives the connection it was spent through,
    # and a deleted connection must not take its ledger rows with it.
    connection_id: UUID | None = Field(default=None, nullable=True, index=True)
    provider: str = Field(sa_column=Column(String, nullable=False))
    model: str = Field(sa_column=Column(String, nullable=False))
    kind: str = Field(sa_column=Column(String, nullable=False, index=True))
    surface: str = Field(sa_column=Column(String, nullable=False, index=True))
    context_type: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    context_id: UUID | None = Field(default=None, nullable=True, index=True)
    quantity: int = Field(nullable=False)
    unit: str = Field(sa_column=Column(String, nullable=False))
    prompt_tokens: int | None = Field(default=None, nullable=True)
    completion_tokens: int | None = Field(default=None, nullable=True)
    cost_usd: float | None = Field(default=None, sa_column=Column(Float, nullable=True))
