"""Chat API routes for sessions and streaming responses."""

from __future__ import annotations

import json
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.dependencies import (
    get_current_user,
    get_session,
    oauth2_scheme,
    require_user_api_keys,
)
from app.db import models
from app.db.repositories import ChatRepository
from app.db.session import engine
from app.schemas.chat import (
    ChatCompletionResponse,
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionRead,
)
from app.api.routes.utils import get_collection_or_404
from app.services.chat import ChatService

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/collections/{collection_id}/chat", response_model=ChatCompletionResponse)
def chat_with_collection(
    collection_id: UUID,
    payload: ChatMessageCreate,
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> ChatCompletionResponse:
    """Send a chat message for a collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
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
    """Stream a chat response for a collection via SSE."""
    session = Session(engine)
    session_closed = False

    def close_session():
        """Ensure the SQL session is closed exactly once."""
        nonlocal session_closed
        if not session_closed:
            session.close()
            session_closed = True

    try:
        current_user = get_current_user(token=token, session=session)
        current_user = require_user_api_keys(current_user)
        collection = get_collection_or_404(
            collection_id=collection_id,
            user_id=current_user.id,
            session=session,
        )
        chat_service = ChatService(session)
    except Exception:  # pylint: disable=broad-exception-caught
        close_session()
        raise

    def format_event(data: dict[str, object]) -> str:
        """Format an SSE data payload."""
        serialized = jsonable_encoder(data)
        return f"data: {json.dumps(serialized)}\n\n"

    async def event_stream():
        """Yield SSE events for the streaming chat session."""
        stream_gen = chat_service.stream_message(
            user=current_user,
            collection=collection,
            payload=payload,
        )
        try:
            for event in stream_gen:
                yield format_event(event)
                if await request.is_disconnected():
                    stream_gen.close()
                    break
        except Exception as exc:  # pylint: disable=broad-exception-caught
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
    """List chat sessions for a collection."""
    get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    repo = ChatRepository(session)
    sessions = repo.list_sessions(collection_id=collection_id, user_id=current_user.id)
    return [ChatSessionRead.from_model(chat_session) for chat_session in sessions]


@router.get("/chat/sessions/{session_id}", response_model=List[ChatMessageRead])
def get_chat_history(
    session_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[ChatMessageRead]:
    """Return chat history for a session."""
    repo = ChatRepository(session)
    session_model = repo.get_session(session_id, user_id=current_user.id)
    if not session_model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    messages = repo.list_messages(session_id)
    return [ChatMessageRead.from_model(message) for message in messages]


@router.delete("/chat/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat_session(
    session_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    """Delete a chat session and its messages."""
    repo = ChatRepository(session)
    session_model = repo.get_session(session_id, user_id=current_user.id)
    if not session_model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    repo.delete_session(session_model)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
