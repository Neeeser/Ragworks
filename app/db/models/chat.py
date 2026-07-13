"""Chat tables: sessions, their tool-collection links, and messages."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Boolean, Column, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import ChatMode, ChatRole


class ChatSession(SQLModel, TimestampMixin, table=True):
    """Chat session metadata."""

    __tablename__ = "chat_sessions"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    collection_id: UUID | None = Field(
        default=None,
        foreign_key="collections.id",
        nullable=True,
        index=True,
    )
    title: str = Field(sa_column=Column(String, nullable=False))
    mode: ChatMode = Field(default=ChatMode.CHAT, sa_column=Column(String, nullable=False))
    chat_model: str = Field(sa_column=Column(String, nullable=False))
    provider_connection_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PGUUID(as_uuid=True),
            ForeignKey("provider_connections.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    context_tokens: int = Field(default=0, nullable=False)
    parameter_overrides: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    provider_preferences: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    stream: bool = Field(default=False, sa_column=Column(Boolean, nullable=False))
    branched_from_session_id: UUID | None = Field(
        default=None,
        foreign_key="chat_sessions.id",
        nullable=True,
        index=True,
    )
    branched_from_message_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PGUUID(as_uuid=True),
            ForeignKey(
                "chat_messages.id",
                name="fk_chat_sessions_branched_from_message_id",
                use_alter=True,
            ),
            nullable=True,
            index=True,
        ),
    )


class ChatSessionCollection(SQLModel, TimestampMixin, table=True):
    """Tool collection associations for chat sessions."""

    __tablename__ = "chat_session_collections"
    __table_args__ = (
        Index("ix_chat_session_collections_collection_id", "collection_id"),
    )

    session_id: UUID = Field(
        foreign_key="chat_sessions.id",
        primary_key=True,
    )
    collection_id: UUID = Field(
        foreign_key="collections.id",
        primary_key=True,
    )


class ChatMessage(SQLModel, TimestampMixin, table=True):
    """Chat message stored in the database."""

    __tablename__ = "chat_messages"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    session_id: UUID = Field(foreign_key="chat_sessions.id", nullable=False, index=True)
    role: ChatRole = Field(sa_column=Column(String, nullable=False))
    content: str = Field(sa_column=Column(Text, nullable=False))
    model: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    tool_name: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    tool_call_id: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    tool_payload: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    reasoning_trace: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    prompt_tokens: int | None = Field(default=None, nullable=True)
    completion_tokens: int | None = Field(default=None, nullable=True)
    usage: dict[str, Any] | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    source_message_id: UUID | None = Field(
        default=None,
        sa_column=Column(
            PGUUID(as_uuid=True),
            ForeignKey(
                "chat_messages.id",
                name="fk_chat_messages_source_message_id",
                use_alter=True,
            ),
            nullable=True,
            index=True,
        ),
    )
