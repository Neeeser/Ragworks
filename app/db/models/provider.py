"""Per-user provider connection table.

A connection is one configured instance of an external provider (an OpenRouter
account, an Ollama server, a Pinecone project). Users may hold several
connections of the same type unless the provider's descriptor caps it; the
`config` JSON is validated against the provider type's config model at the
service boundary before it is ever written here.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, DateTime, ForeignKey, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class ProviderConnection(SQLModel, TimestampMixin, table=True):
    """One configured provider instance owned by a user."""

    __tablename__ = "provider_connections"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(
        sa_column=Column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    provider_type: str = Field(sa_column=Column(String(32), nullable=False))
    label: str = Field(sa_column=Column(String(100), nullable=False))
    config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    #: When the stored config last answered a live probe. Null means the
    #: connection was saved without ever being reached — the user chose "Save
    #: anyway" past a failed test, or saved while the server was down. Any
    #: config change clears it, because the value that answered is gone.
    #: Capability gates treat null like an invalid config: a provider whose
    #: kinds are probe-derived (TEI serves exactly one of embedding/reranking)
    #: falls back to its descriptor's declared kinds when the probe fails, so
    #: an unverified row would otherwise offer a capability it cannot serve.
    last_validated_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
