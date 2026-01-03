"""Persistence helpers for chat messages and sessions."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageRead, ChatSessionRead
from app.utils.time import utc_now


@dataclass(frozen=True)
class RecordContext:
    """Database context for recording chat artifacts."""

    session: Session
    chat_repo: ChatRepository


@dataclass(frozen=True)
class ToolCallRecord:
    """Tool call metadata for persisted chat messages."""

    name: Optional[str] = None
    call_id: Optional[str] = None
    payload: Optional[Dict[str, object]] = None


@dataclass(frozen=True)
class MessageRecord:
    """Payload describing a chat message to persist."""

    session_id: UUID
    role: models.ChatRole
    content: str
    model: Optional[str] = None
    tool: Optional[ToolCallRecord] = None
    reasoning: Optional[Dict[str, object]] = None
    usage: Optional[Dict[str, int]] = None


def serialize_message(message: models.ChatMessage) -> Dict[str, object]:
    """Serialize stored chat messages for provider requests."""
    if message.role == models.ChatRole.TOOL:
        return {
            "role": "tool",
            "tool_call_id": message.tool_call_id,
            "content": message.content,
        }
    if isinstance(message.role, models.ChatRole):
        role_value = message.role.value
    else:
        role_value = str(message.role)
    serialized: Dict[str, object] = {"role": role_value, "content": message.content}
    tool_payload = message.tool_payload
    if (
        isinstance(tool_payload, dict)
        and message.role == models.ChatRole.ASSISTANT
        and isinstance(tool_payload.get("tool_calls"), list)
    ):
        serialized["tool_calls"] = deepcopy(tool_payload["tool_calls"])
    return serialized


def record_message(context: RecordContext, record: MessageRecord) -> models.ChatMessage:
    """Persist a chat message and return it."""
    usage_payload = record.usage or {}
    tool_info = record.tool
    message = models.ChatMessage(
        session_id=record.session_id,
        role=record.role,
        content=record.content,
        model=record.model,
        tool_name=tool_info.name if tool_info else None,
        tool_call_id=tool_info.call_id if tool_info else None,
        tool_payload=tool_info.payload if tool_info else None,
        reasoning_trace=record.reasoning,
        prompt_tokens=usage_payload.get("prompt_tokens"),
        completion_tokens=usage_payload.get("completion_tokens"),
        usage=usage_payload or None,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    context.chat_repo.add_message(message)
    context.session.commit()
    return message


def record_tool_call_assistant_message(
    *,
    context: RecordContext,
    session_model: models.ChatSession,
    content: str,
    tool_calls: List[Dict[str, Any]],
) -> None:
    """Persist assistant tool-call messages to the database."""
    if not tool_calls:
        return
    tool_call_payload = {"tool_calls": deepcopy(tool_calls)}
    record_message(
        context,
        MessageRecord(
            session_id=session_model.id,
            role=models.ChatRole.ASSISTANT,
            content=content or "",
            tool=ToolCallRecord(payload=tool_call_payload),
        ),
    )
    session_model.updated_at = utc_now()
    context.session.add(session_model)
    context.session.flush()


def record_partial_assistant_message(
    *,
    context: RecordContext,
    session_model: models.ChatSession,
    content: str,
    reasoning_segments: Optional[List[Dict[str, Any]]],
    model: Optional[str],
) -> None:
    """Persist a partial assistant response when streaming closes."""
    trimmed_content = (content or "").strip()
    has_reasoning = bool(reasoning_segments)
    if not trimmed_content and not has_reasoning:
        return
    reasoning_payload = {"segments": reasoning_segments} if reasoning_segments else None
    record_message(
        context,
        MessageRecord(
            session_id=session_model.id,
            role=models.ChatRole.ASSISTANT,
            content=content or "",
            model=model or session_model.chat_model,
            reasoning=reasoning_payload,
        ),
    )
    session_model.updated_at = utc_now()
    context.session.add(session_model)
    context.session.flush()


def convert_session(session_model: models.ChatSession) -> ChatSessionRead:
    """Convert a session model into a response schema."""
    return ChatSessionRead.from_model(session_model)


def convert_messages(
    *,
    chat_repo: ChatRepository,
    session_id: UUID,
) -> List[ChatMessageRead]:
    """Convert stored messages into response schemas."""
    messages = chat_repo.list_messages(session_id)
    return [ChatMessageRead.from_model(msg) for msg in messages]
