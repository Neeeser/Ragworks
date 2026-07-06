"""Chat session branching: fork a session at a chosen message.

`branch_session` creates a new session that copies history up to and including
a target message, preserving source links, tool-collection assignments, and run
settings. All error paths raise `InvalidInputError` (translated to 400 at the
route via `to_http_exception`, preserving the status code the legacy
`ValueError` path used to produce): unknown session, unknown message, or a
message that belongs to a different session.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.chat.persistence import convert_session
from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatBranchResponse, ChatMessageRead
from app.services.errors import InvalidInputError
from app.utils.time import utc_now


def resolve_branch_title(session_title: str, requested_title: str | None) -> str:
    """Return the new session title for a branched chat."""
    trimmed_title = (requested_title or "").strip()
    if trimmed_title:
        return trimmed_title
    base_title = session_title or "Chat"
    return f"Branch of {base_title}"


def _copy_branch_messages(
    *,
    chat_repo: ChatRepository,
    branch_session_id: UUID,
    messages: list[models.ChatMessage],
) -> list[models.ChatMessage]:
    """Copy messages into a branched session, preserving source links."""
    branched_messages: list[models.ChatMessage] = []
    for message in messages:
        branched_message = models.ChatMessage(
            session_id=branch_session_id,
            role=message.role,
            content=message.content,
            model=message.model,
            tool_name=message.tool_name,
            tool_call_id=message.tool_call_id,
            tool_payload=message.tool_payload,
            reasoning_trace=message.reasoning_trace,
            prompt_tokens=message.prompt_tokens,
            completion_tokens=message.completion_tokens,
            usage=message.usage,
            source_message_id=message.id,
            created_at=message.created_at,
            updated_at=message.updated_at,
        )
        chat_repo.add_message(branched_message)
        branched_messages.append(branched_message)
    return branched_messages


def branch_session(
    *,
    session: Session,
    chat_repo: ChatRepository,
    user: models.User,
    session_id: UUID,
    message_id: UUID,
    title: str | None,
) -> ChatBranchResponse:
    """Create a new chat session branched from a specific message."""
    session_model = chat_repo.get_session(session_id, user_id=user.id)
    if not session_model:
        raise InvalidInputError("Chat session not found.")
    target_message = chat_repo.get_message(message_id, user_id=user.id)
    if not target_message:
        raise InvalidInputError("Message not found for branching.")
    if target_message.session_id != session_model.id:
        raise InvalidInputError("Message does not belong to this session.")

    messages = chat_repo.list_messages(session_model.id, limit=None)
    target_index = next(
        (index for index, message in enumerate(messages) if message.id == target_message.id),
        -1,
    )
    if target_index < 0:
        raise InvalidInputError("Message not found in session history.")
    branch_title = resolve_branch_title(session_model.title, title)
    branched_session = models.ChatSession(
        user_id=user.id,
        collection_id=session_model.collection_id,
        title=branch_title,
        mode=session_model.mode,
        chat_model=session_model.chat_model,
        context_tokens=0,
        parameter_overrides=session_model.parameter_overrides,
        provider_preferences=session_model.provider_preferences,
        stream=session_model.stream,
        branched_from_session_id=session_model.id,
        branched_from_message_id=target_message.id,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    chat_repo.add_session(branched_session)
    tool_collection_ids = chat_repo.list_session_collection_ids(session_model.id)
    if tool_collection_ids:
        chat_repo.replace_session_collections(
            session_id=branched_session.id,
            collection_ids=tool_collection_ids,
        )

    branched_messages = _copy_branch_messages(
        chat_repo=chat_repo,
        branch_session_id=branched_session.id,
        messages=messages[: target_index + 1],
    )

    session.commit()
    return ChatBranchResponse(
        session=convert_session(branched_session, tool_collection_ids=tool_collection_ids),
        messages=[ChatMessageRead.from_model(msg) for msg in branched_messages],
    )
