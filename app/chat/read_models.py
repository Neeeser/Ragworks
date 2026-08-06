"""Read models for chat sessions and messages.

Projection only — the wire shapes a route returns, built from rows the
persistence layer wrote. Kept apart so a schema-shaping change never sits
in the same module as the writes.
"""

from __future__ import annotations

from uuid import UUID

from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageRead, ChatSessionRead


def convert_session(
    session_model: models.ChatSession,
    *,
    tool_collection_ids: list[UUID] | None = None,
) -> ChatSessionRead:
    """Convert a session model into a response schema."""
    return ChatSessionRead.from_model(
        session_model,
        tool_collection_ids=tool_collection_ids,
    )


def convert_messages(
    *,
    chat_repo: ChatRepository,
    session_id: UUID,
) -> list[ChatMessageRead]:
    """Convert stored messages into response schemas."""
    messages = chat_repo.list_messages(session_id)
    return [ChatMessageRead.from_model(msg) for msg in messages]
