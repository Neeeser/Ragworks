from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.db.repositories import ChatRepository, CollectionRepository
from app.schemas.chat import (
    ChatCompletionResponse,
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionRead,
)
from app.services.chat import ChatService

router = APIRouter(prefix="/api", tags=["chat"])


def _session_to_schema(session_model: models.ChatSession) -> ChatSessionRead:
    return ChatSessionRead(
        id=session_model.id,
        collection_id=session_model.collection_id,
        user_id=session_model.user_id,
        title=session_model.title,
        mode=session_model.mode,
        chat_model=session_model.chat_model,
        context_tokens=session_model.context_tokens,
        created_at=session_model.created_at,
        updated_at=session_model.updated_at,
    )


def _message_to_schema(message: models.ChatMessage) -> ChatMessageRead:
    return ChatMessageRead(
        id=message.id,
        session_id=message.session_id,
        role=message.role,
        content=message.content,
        model=message.model,
        tool_name=message.tool_name,
        tool_payload=message.tool_payload,
        tool_call_id=message.tool_call_id,
        reasoning_trace=message.reasoning_trace,
        prompt_tokens=message.prompt_tokens,
        completion_tokens=message.completion_tokens,
        created_at=message.created_at,
    )


@router.post("/collections/{collection_id}/chat", response_model=ChatCompletionResponse)
def chat_with_collection(
    collection_id: UUID,
    payload: ChatMessageCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChatCompletionResponse:
    collection_repo = CollectionRepository(session)
    collection = collection_repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    chat_service = ChatService(session)
    return chat_service.send_message(user=current_user, collection=collection, payload=payload)


@router.get("/collections/{collection_id}/sessions", response_model=List[ChatSessionRead])
def list_sessions(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[ChatSessionRead]:
    collection_repo = CollectionRepository(session)
    collection = collection_repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    repo = ChatRepository(session)
    sessions = repo.list_sessions(collection_id=collection_id, user_id=current_user.id)
    return [_session_to_schema(chat_session) for chat_session in sessions]


@router.get("/chat/sessions/{session_id}", response_model=List[ChatMessageRead])
def get_chat_history(
    session_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[ChatMessageRead]:
    repo = ChatRepository(session)
    session_model = repo.get_session(session_id, user_id=current_user.id)
    if not session_model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    messages = repo.list_messages(session_id)
    return [_message_to_schema(message) for message in messages]

