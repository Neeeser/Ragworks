"""API key table: bearer credentials for the MCP endpoint.

A key is a per-user credential an agent harness holds. Only its sha256 digest
is stored — the secret is shown once at creation and is unrecoverable
afterwards — mirroring `auth_sessions.token_digest`. Scope is two independent
dimensions: `capabilities` (what the bearer may do) and the collections it
reaches (`all_collections`, else the explicit `collection_ids` list). Both are
enforced on every MCP request, so the URL an agent is pointed at is
convenience while the key remains the security boundary.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, DateTime, ForeignKey, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class ApiKey(SQLModel, TimestampMixin, table=True):
    """One scoped API key for programmatic (MCP) access."""

    __tablename__ = "api_keys"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(
        sa_column=Column(
            ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    name: str = Field(sa_column=Column(String, nullable=False))
    #: Non-secret display prefix (`rw_` plus the secret's first characters).
    prefix: str = Field(sa_column=Column(String(16), nullable=False))
    token_digest: str = Field(
        sa_column=Column(String(64), unique=True, index=True, nullable=False)
    )
    #: `ApiKeyCapability` values; stored as strings so a new member needs no migration.
    capabilities: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    #: True when the key reaches every collection the user owns, now and later.
    all_collections: bool = Field(default=False, nullable=False)
    #: Explicit collection ids (as strings) when `all_collections` is false.
    collection_ids: list[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    last_used_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    expires_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    revoked_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
