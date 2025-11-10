from __future__ import annotations

from typing import List
from uuid import UUID

import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session, oauth2_scheme
from app.db import models
from app.db.repositories import ChatRepository, CollectionRepository
from app.db.session import engine
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
        usage=message.usage,
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
    try:
        return chat_service.send_message(user=current_user, collection=collection, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/collections/{collection_id}/chat/stream")
def stream_chat_with_collection(
    collection_id: UUID,
    payload: ChatMessageCreate,
    request: Request,
    token: str = Depends(oauth2_scheme),
) -> StreamingResponse:
    session = Session(engine)
    session_closed = False

    def close_session():
        nonlocal session_closed
        if not session_closed:
            session.close()
            session_closed = True

    try:
        current_user = get_current_user(token=token, session=session)
        collection_repo = CollectionRepository(session)
        collection = collection_repo.get(collection_id, user_id=current_user.id)
        if not collection:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
        chat_service = ChatService(session)
    except Exception:
        close_session()
        raise

    def format_event(data: dict[str, object]) -> str:
        serialized = jsonable_encoder(data)
        return f"data: {json.dumps(serialized)}\n\n"

    async def event_stream():
        stream_gen = chat_service.stream_message(user=current_user, collection=collection, payload=payload)
        try:
            for event in stream_gen:
                yield format_event(event)
                if await request.is_disconnected():
                    stream_gen.close()
                    break
        except Exception as exc:  # noqa: BLE001
            message = str(exc) or "Streaming request failed."
            yield format_event({"type": "error", "message": message})
        finally:
            yield "data: [DONE]\n\n"
            close_session()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


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


@router.delete("/chat/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat_session(
    session_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    repo = ChatRepository(session)
    session_model = repo.get_session(session_id, user_id=current_user.id)
    if not session_model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    repo.delete_session(session_model)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
