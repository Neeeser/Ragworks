"""Persistence for chat messages, sessions, run preferences, and prompts.

This module is the single home for the chat subsystem's database writes and
for the read boundary that turns persisted rows back into the typed
`ProviderMessage` vocabulary. Message history is stored leniently (a
`tool_payload` JSON column whose `tool_calls` entries predate the `ToolCall`
model can be missing `type`/`function`), so `provider_message_from_model`
normalizes every stored row into a strict `ProviderMessage` at read time and
`serialize_messages` renders those back to provider request dicts only at the
request boundary — old data can never crash the request build.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from sqlmodel import Session

from app.chat.messages import (
    AssistantMessage,
    FunctionCall,
    ProviderMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
    UserMessage,
)
from app.chat.tool_calls import ensure_arguments_string
from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageCreate, ChatMessageRead, ChatSessionRead
from app.services.errors import InvalidInputError
from app.utils.time import utc_now


@dataclass(frozen=True)
class RecordContext:
    """Database context for recording chat artifacts."""

    session: Session
    chat_repo: ChatRepository


@dataclass(frozen=True)
class ToolCallRecord:
    """Tool call metadata for persisted chat messages."""

    name: str | None = None
    call_id: str | None = None
    payload: dict[str, object] | None = None


@dataclass(frozen=True)
class MessageRecord:
    """Payload describing a chat message to persist."""

    session_id: UUID
    role: models.ChatRole
    content: str
    model: str | None = None
    tool: ToolCallRecord | None = None
    reasoning: dict[str, object] | None = None
    usage: dict[str, int] | None = None


@dataclass(frozen=True)
class SessionRequest:
    """Payload required to create or resolve chat sessions."""

    chat_repo: ChatRepository
    session: Session
    user: models.User
    payload: ChatMessageCreate
    primary_collection_id: UUID | None = None


@dataclass(frozen=True)
class SessionPreferencesUpdate:
    """Normalized run settings persisted for sessions and users."""

    parameter_overrides: dict[str, Any] | None
    provider_preferences: dict[str, Any] | None
    stream_enabled: bool
    tool_collection_ids: list[UUID]


# --- Read boundary: persisted rows -> typed provider messages ---------------


def _tool_call_from_disk(raw: Any) -> ToolCall | None:
    """Normalize one persisted tool-call entry into a strict `ToolCall`.

    Lenient by design: entries stored before the `ToolCall` model may omit
    `type`/`function` or carry the name/arguments at the top level. Missing
    ids are backfilled and arguments are coerced to a JSON string, so the
    result is always a regular `ToolCall`; unusable entries return `None`.
    """
    if not isinstance(raw, dict):
        return None
    function = raw.get("function")
    if not isinstance(function, dict):
        function = {}
    name = function.get("name") or raw.get("name") or ""
    arguments_str = ensure_arguments_string(function.get("arguments") or raw.get("arguments"))
    call_id = str(raw.get("id") or f"tool_call_{uuid4().hex}")
    return ToolCall(id=call_id, function=FunctionCall(name=str(name), arguments=arguments_str))


def provider_message_from_model(message: models.ChatMessage) -> ProviderMessage:
    """Convert a persisted chat message into a typed `ProviderMessage`.

    This is the lenient on-disk normalization boundary: content is coerced to a
    string and assistant `tool_calls` are rebuilt through `_tool_call_from_disk`
    so historical/partial shapes replay without failing strict validation.
    """
    content = message.content or ""
    if message.role == models.ChatRole.TOOL:
        return ToolMessage(tool_call_id=message.tool_call_id, content=content)
    if message.role == models.ChatRole.SYSTEM:
        return SystemMessage(content=content)
    if message.role == models.ChatRole.ASSISTANT:
        tool_calls: list[ToolCall] | None = None
        tool_payload = message.tool_payload
        if isinstance(tool_payload, dict) and isinstance(tool_payload.get("tool_calls"), list):
            resolved = [_tool_call_from_disk(entry) for entry in tool_payload["tool_calls"]]
            tool_calls = [call for call in resolved if call is not None] or None
        return AssistantMessage(content=content, tool_calls=tool_calls)
    return UserMessage(content=content)


def serialize_messages(messages: list[ProviderMessage]) -> list[dict[str, Any]]:
    """Render typed provider messages into request dicts at the wire boundary."""
    return [message.model_dump(exclude_none=True) for message in messages]


# --- Message writes ---------------------------------------------------------


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
    tool_calls: list[dict[str, Any]],
) -> None:
    """Persist assistant tool-call messages to the database."""
    if not tool_calls:
        return
    tool_call_payload: dict[str, object] = {"tool_calls": deepcopy(tool_calls)}
    record_message(
        context,
        MessageRecord(
            session_id=session_model.id,
            role=models.ChatRole.ASSISTANT,
            content=content or "",
            tool=ToolCallRecord(payload=tool_call_payload),
        ),
    )
    # session_model's own columns don't otherwise change here (only the new
    # message row does) -- this manual touch is what makes the row dirty so
    # its updated_at reflects the new message; onupdate alone wouldn't fire.
    session_model.updated_at = utc_now()
    context.session.add(session_model)
    context.session.flush()


def record_partial_assistant_message(
    *,
    context: RecordContext,
    session_model: models.ChatSession,
    content: str,
    reasoning_segments: list[dict[str, Any]] | None,
    model: str | None,
) -> None:
    """Persist a partial assistant response when streaming closes."""
    trimmed_content = (content or "").strip()
    has_reasoning = bool(reasoning_segments)
    if not trimmed_content and not has_reasoning:
        return
    reasoning_payload: dict[str, object] | None = (
        {"segments": reasoning_segments} if reasoning_segments else None
    )
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
    # Same reasoning as record_tool_call_assistant_message above: nothing else
    # on session_model changes in this path, so this touch is load-bearing.
    session_model.updated_at = utc_now()
    context.session.add(session_model)
    context.session.flush()


# --- Response conversion ----------------------------------------------------


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


# --- Session resolution and edits -------------------------------------------


def ensure_session(request: SessionRequest) -> models.ChatSession:
    """Find or create a chat session for the payload."""
    payload = request.payload
    if payload.session_id:
        existing = request.chat_repo.get_session(payload.session_id, user_id=request.user.id)
        if existing:
            return existing
        # The id isn't owned by this user. If it belongs to *another* user,
        # reject as not-found rather than attempting to create a session under a
        # colliding primary key (which surfaced as an opaque IntegrityError/500
        # and is a cross-user access attempt). A genuinely unused client-supplied
        # id still creates a new session below.
        if request.chat_repo.get_session(payload.session_id) is not None:
            raise InvalidInputError("Chat session not found.")
        return create_session(request=request, session_id=payload.session_id)
    return create_session(request=request)


def create_session(
    *,
    request: SessionRequest,
    session_id: UUID | None = None,
) -> models.ChatSession:
    """Create and persist a new chat session."""
    payload = request.payload
    base_title = payload.title or (payload.content[:60] if payload.content else None)
    fallback_title = f"Chat {utc_now().strftime('%H:%M:%S')}"
    last_used_model = (request.user.last_used_chat_model or "").strip()
    # No global default models exist: a new session seeds from the payload,
    # falling back to the user's sticky last-used choice; setup raises a clear
    # error later when neither yields a model.
    preferred_model = (payload.chat_model or "").strip() or last_used_model
    preferred_connection = (
        payload.provider_connection_id or request.user.last_used_chat_connection_id
    )
    session_model = models.ChatSession(
        id=session_id or uuid4(),
        user_id=request.user.id,
        collection_id=request.primary_collection_id,
        title=base_title or fallback_title,
        mode=payload.mode,
        chat_model=preferred_model,
        provider_connection_id=preferred_connection,
    )
    request.chat_repo.add_session(session_model)
    request.session.commit()
    return session_model


def apply_edit(
    *,
    session: Session,
    chat_repo: ChatRepository,
    session_model: models.ChatSession,
    target_message: models.ChatMessage,
    new_content: str | None,
) -> None:
    """Apply edits to a message and prune dependent history."""
    if target_message.session_id != session_model.id:
        raise InvalidInputError("Message does not belong to this session.")

    if target_message.role == models.ChatRole.USER:
        trimmed = (new_content or "").strip()
        if not trimmed:
            raise InvalidInputError("Edited message cannot be empty.")
        target_message.content = trimmed
        session.add(target_message)
        session.flush()
        chat_repo.delete_messages_after(
            session_id=session_model.id,
            created_at=target_message.created_at,
            include_anchor=False,
        )
    else:
        user_threshold = target_message.created_at
        last_user = chat_repo.get_last_user_message_before(
            session_model.id,
            target_message.created_at,
        )
        if last_user:
            user_threshold = last_user.created_at
        anchor_message = chat_repo.get_message_anchor(session_model.id, user_threshold)
        if anchor_message:
            anchor_created_at = anchor_message.created_at
        else:
            anchor_created_at = target_message.created_at
        chat_repo.delete_tool_messages_since(
            session_id=session_model.id,
            since=user_threshold,
        )
        chat_repo.delete_messages_after(
            session_id=session_model.id,
            created_at=anchor_created_at,
            include_anchor=True,
        )
    # session_model's own columns don't otherwise change here (only the edited
    # message row and deleted rows do) -- this manual touch is what makes the
    # row dirty so its updated_at reflects the edit; onupdate alone wouldn't
    # fire without it.
    session_model.updated_at = utc_now()
    session.add(session_model)
    session.flush()


# --- Run-preference and account persistence ---------------------------------


def persist_session_preferences(
    *,
    session: Session,
    session_model: models.ChatSession,
    user: models.User,
    preferences: SessionPreferencesUpdate,
) -> None:
    """Persist session and user-level run settings for future chats."""
    parameter_overrides = preferences.parameter_overrides or None
    provider_preferences = preferences.provider_preferences or None
    session_model.parameter_overrides = parameter_overrides
    session_model.provider_preferences = provider_preferences
    session_model.stream = preferences.stream_enabled
    user.last_used_chat_model = session_model.chat_model
    user.last_used_chat_connection_id = session_model.provider_connection_id
    user.last_used_parameters = parameter_overrides
    user.last_used_provider = provider_preferences
    user.last_used_stream = preferences.stream_enabled
    user.last_used_tool_collection_ids = [
        str(collection_id) for collection_id in preferences.tool_collection_ids
    ]
    session.add(session_model)
    session.add(user)
    session.flush()
