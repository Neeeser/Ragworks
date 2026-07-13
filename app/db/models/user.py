"""User account table and the shared timestamp mixin every table inherits."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlmodel import Field, SQLModel

from app.schemas.enums import UserRole
from app.utils.time import utc_now


class TimestampMixin:  # pylint: disable=too-few-public-methods
    """Shared timestamp fields for SQLModel tables.

    `updated_at` carries an `onupdate` so SQLAlchemy refreshes it on every
    UPDATE statement automatically -- call sites must not set it manually.
    """

    created_at: datetime = Field(default_factory=utc_now, nullable=False)
    updated_at: datetime = Field(
        default_factory=utc_now,
        nullable=False,
        sa_column_kwargs={"onupdate": utc_now},
    )


class User(SQLModel, TimestampMixin, table=True):
    """User account record."""

    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    email: str = Field(sa_column=Column(String, unique=True, index=True, nullable=False))
    full_name: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    hashed_password: str = Field(sa_column=Column(String, nullable=False))
    system_prompt_template: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    last_used_chat_model: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True),
    )
    last_used_chat_connection_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PGUUID(as_uuid=True),
            ForeignKey(
                "provider_connections.id",
                name="fk_users_last_used_chat_connection_id",
                ondelete="SET NULL",
                use_alter=True,
            ),
            nullable=True,
        ),
    )
    last_used_parameters: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    last_used_provider: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    last_used_stream: bool | None = Field(
        default=None,
        sa_column=Column(Boolean, nullable=True),
    )
    last_used_tool_collection_ids: list[str] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    run_settings_order: list[str] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    remember_session_days: int = Field(default=30, nullable=False)
    is_active: bool = Field(default=True, nullable=False)
    role: str = Field(
        default=UserRole.USER.value,
        sa_column=Column(String, nullable=False, server_default=UserRole.USER.value),
    )


class AuthSession(SQLModel, table=True):
    """Revocable refresh session for one signed-in browser."""

    __tablename__ = "auth_sessions"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(
        sa_column=Column(
            ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
        )
    )
    token_digest: str = Field(
        sa_column=Column(String(64), unique=True, index=True, nullable=False)
    )
    previous_token_digest: str | None = Field(
        default=None, sa_column=Column(String(64), index=True, nullable=True)
    )
    user_agent: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    ip_address: str | None = Field(default=None, sa_column=Column(String(45), nullable=True))
    persistent: bool = Field(default=False, nullable=False)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    last_used_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    revoked_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
