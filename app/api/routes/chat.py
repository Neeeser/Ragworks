"""Chat API routes for sessions and streaming responses."""

from __future__ import annotations

import json
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.dependencies import (
    get_current_user,
    get_session,
    oauth2_scheme,
    require_openrouter_key,
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
from app.schemas.prompts import PromptTemplateRead, PromptTemplateUpdate
from app.services.prompts import (
    apply_prompt_template,
    base_prompt_context,
    get_base_prompt_template,
    is_base_prompt_custom,
    prompt_variables_payload,
)
from app.services.chat import ChatService

router = APIRouter(prefix="/api", tags=["chat"])


@router.get("/chat/prompt", response_model=PromptTemplateRead)
def get_base_prompt(
    current_user: models.User = Depends(get_current_user),
) -> PromptTemplateRead:
    """Return the rendered base system prompt for the current user."""
    template = get_base_prompt_template(current_user)
    context = base_prompt_context(current_user)
    rendered = apply_prompt_template(template, context)
    return PromptTemplateRead(
        template=template,
        rendered=rendered,
        context=context,
        variables=prompt_variables_payload(scope="base"),
        is_custom=is_base_prompt_custom(current_user),
    )


@router.patch("/chat/prompt", response_model=PromptTemplateRead)
def update_base_prompt(
    payload: PromptTemplateUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptTemplateRead:
    """Update the base system prompt for the current user."""
    template = (payload.template or "").strip()
    current_user.system_prompt_template = template or None
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    template = get_base_prompt_template(current_user)
    context = base_prompt_context(current_user)
    rendered = apply_prompt_template(template, context)
    return PromptTemplateRead(
        template=template,
        rendered=rendered,
        context=context,
        variables=prompt_variables_payload(scope="base"),
        is_custom=is_base_prompt_custom(current_user),
    )


@router.post("/chat", response_model=ChatCompletionResponse)
def chat(
    payload: ChatMessageCreate,
    current_user: models.User = Depends(require_openrouter_key),
    session: Session = Depends(get_session),
) -> ChatCompletionResponse:
    """Send a chat message with optional tool collections."""
    chat_service = ChatService(session)
    try:
        return chat_service.send_message(user=current_user, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/chat/stream")
def stream_chat(
    payload: ChatMessageCreate,
    request: Request,
    token: str = Depends(oauth2_scheme),
) -> StreamingResponse:
    """Stream a chat response via SSE."""
    session = Session(engine)
    session_closed = False

    def close_session():
        """Ensure the SQL session is closed exactly once."""
        nonlocal session_closed
        session.close()
        session_closed = True

    try:
        current_user = get_current_user(token=token, session=session)
        current_user = require_openrouter_key(current_user)
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


@router.get("/chat/sessions", response_model=List[ChatSessionRead])
def list_sessions(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
    collection_ids: Optional[List[UUID]] = Query(default=None),
    include_unassigned: bool = Query(default=False),
) -> List[ChatSessionRead]:
    """List chat sessions for a user, optionally filtered by tool collections."""
    repo = ChatRepository(session)
    sessions = repo.list_sessions(
        user_id=current_user.id,
        collection_ids=collection_ids,
        include_unassigned=include_unassigned,
    )
    session_ids = [chat_session.id for chat_session in sessions]
    tool_map = repo.list_session_collection_ids_for_sessions(session_ids)
    return [
        ChatSessionRead.from_model(
            chat_session,
            tool_collection_ids=tool_map.get(chat_session.id, []),
        )
        for chat_session in sessions
    ]


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
