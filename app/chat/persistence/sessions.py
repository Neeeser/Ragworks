"""Session helpers for chat workflows."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import asc
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import ChatRepository
from app.schemas.chat import ChatMessageCreate
from app.utils.time import utc_now


@dataclass(frozen=True)
class SessionRequest:
    """Payload required to create or resolve chat sessions."""

    chat_repo: ChatRepository
    session: Session
    user: models.User
    collection: models.Collection
    payload: ChatMessageCreate
    default_chat_model: str


def ensure_session(request: SessionRequest) -> models.ChatSession:
    """Find or create a chat session for the payload."""
    payload = request.payload
    if payload.session_id:
        existing = request.chat_repo.get_session(payload.session_id, user_id=request.user.id)
        if existing:
            if existing.collection_id != request.collection.id:
                raise ValueError("Session does not belong to this collection.")
            return existing
        return create_session(
            request=request,
            session_id=payload.session_id,
        )
    return create_session(
        request=request,
    )


def create_session(
    *,
    request: SessionRequest,
    session_id: Optional[UUID] = None,
) -> models.ChatSession:
    """Create and persist a new chat session."""
    payload = request.payload
    base_title = payload.title or (payload.content[:60] if payload.content else None)
    fallback_title = f"Chat {utc_now().strftime('%H:%M:%S')}"
    preferred_model = (payload.chat_model or "").strip() or request.default_chat_model
    session_model = models.ChatSession(
        id=session_id or uuid4(),
        user_id=request.user.id,
        collection_id=request.collection.id,
        title=base_title or fallback_title,
        mode=payload.mode,
        chat_model=preferred_model,
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
    new_content: Optional[str],
) -> None:
    """Apply edits to a message and prune dependent history."""
    if target_message.session_id != session_model.id:
        raise ValueError("Message does not belong to this session.")

    if target_message.role == models.ChatRole.USER:
        trimmed = (new_content or "").strip()
        if not trimmed:
            raise ValueError("Edited message cannot be empty.")
        target_message.content = trimmed
        target_message.updated_at = utc_now()
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
        anchor_statement = (
            select(models.ChatMessage)
            .where(
                models.ChatMessage.session_id == session_model.id,
                models.ChatMessage.created_at >= user_threshold,
                models.ChatMessage.role != models.ChatRole.USER,
            )
            .order_by(asc(models.ChatMessage.created_at))
            .limit(1)
        )
        anchor_message = session.exec(anchor_statement).first()
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
    session_model.updated_at = utc_now()
    session.add(session_model)
    session.flush()
