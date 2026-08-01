"""Per-user model shortlists: pinned models and recently used models.

A shortlist is what makes a model picker usable once a connection publishes
hundreds of models: the models a user actually works with are surfaced ahead
of the catalog instead of being searched for every time. Entries reference a
model as a `(connection_id, model_id)` pair, so deleting a connection removes
its entries with it and nothing is ever left pointing at a provider the user
no longer has.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import ProviderKind, ShortlistEntryType


class ModelShortlistRow(SQLModel, TimestampMixin, table=True):
    """One model a user pinned, or last used, for one model kind.

    `(user_id, kind, entry_type, connection_id, model_id)` is unique: the same
    model can be both pinned and recent, but never twice in either role -- a
    duplicate would render as two identical rows the user cannot tell apart.
    `last_used_at` is set only on recents, and is what the prune orders by.
    """

    __tablename__ = "model_shortlist_entries"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "kind",
            "entry_type",
            "connection_id",
            "model_id",
            name="uq_model_shortlist_identity",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(
        sa_column=Column(
            ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    connection_id: UUID = Field(
        sa_column=Column(
            ForeignKey("provider_connections.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    kind: ProviderKind = Field(sa_column=Column(String(32), nullable=False, index=True))
    entry_type: ShortlistEntryType = Field(
        sa_column=Column(String(16), nullable=False, index=True)
    )
    model_id: str = Field(sa_column=Column(String(200), nullable=False))
    last_used_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
