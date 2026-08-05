"""Chat API routes for sessions and streaming responses."""

from __future__ import annotations

import json
import mimetypes
from collections.abc import AsyncIterator
from contextlib import ExitStack
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session

from app.api.dependencies import (
    get_current_user,
    get_session,
    oauth2_scheme,
)
from app.api.routes.utils import to_http_exception
from app.chat import ChatService
from app.chat.attachments import purge_session_assets
from app.chat.events import ErrorEvent
from app.db import models
from app.db.engine import stream_scoped_session
from app.db.repositories import ChatRepository
from app.schemas.chat import (
    ChatBranchCreate,
    ChatBranchResponse,
    ChatCompletionResponse,
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionRead,
)
from app.schemas.prompts import PromptReference, PromptSelectionRead, PromptSelectionUpdate
from app.services.accounts import AccountService
from app.services.app_config import get_app_config
from app.services.errors import ServiceError
from app.services.files import resolve_chat_asset
from app.services.prompts.selection import base_prompt_selection
from app.utils.file_storage import FileStorage

router = APIRouter(prefix="/api", tags=["chat"])


def require_chat_branching_enabled() -> None:
    """Gate the branch route behind the chat-branching feature flag.

    404, not 403: a disabled feature is indistinguishable from an absent
    one -- the common OSS shape for feature-flagged routes.
    """
    if not get_app_config().features.chat_branching:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


@router.get("/chat/prompt", response_model=PromptSelectionRead)
def get_base_prompt(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptSelectionRead:
    """Return the user's base prompt selection and its rendering."""
    return base_prompt_selection(session, current_user)


@router.patch("/chat/prompt", response_model=PromptSelectionRead)
def update_base_prompt(
    payload: PromptSelectionUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptSelectionRead:
    """Point the user's base prompt at a library prompt."""
    reference = PromptReference(prompt_id=payload.prompt_id, version=payload.version)
    try:
        AccountService(session).set_base_prompt(current_user, reference)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return base_prompt_selection(session, current_user)


@router.post("/chat", response_model=ChatCompletionResponse)
def chat(
    payload: ChatMessageCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChatCompletionResponse:
    """Send a chat message with optional tool collections."""
    chat_service = ChatService(session)
    try:
        return chat_service.send_message(user=current_user, payload=payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("/chat/stream")
def stream_chat(
    payload: ChatMessageCreate,
    request: Request,
    token: str = Depends(oauth2_scheme),
) -> StreamingResponse:
    """Stream a chat response via SSE."""
    # Setup runs synchronously so auth failures surface as HTTP errors, not
    # mid-stream SSE. stream_scoped_session owns the session; on setup failure
    # the ExitStack closes it, otherwise pop_all() hands cleanup to the
    # streaming generator (which outlives this handler) via `session_cleanup`.
    with ExitStack() as stack:
        session = stack.enter_context(stream_scoped_session())
        current_user = get_current_user(request=request, token=token, session=session)
        chat_service = ChatService(session)
        session_cleanup = stack.pop_all()

    def format_event(data: dict[str, object]) -> str:
        """Format an SSE data payload."""
        serialized = jsonable_encoder(data)
        return f"data: {json.dumps(serialized)}\n\n"

    async def event_stream() -> AsyncIterator[str]:
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
        except Exception as exc:
            message = str(exc) or "Streaming request failed."
            yield format_event(ErrorEvent(message=message).model_dump())
        finally:
            yield "data: [DONE]\n\n"
            session_cleanup.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/chat/sessions", response_model=list[ChatSessionRead])
def list_sessions(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
    collection_ids: list[UUID] | None = Query(default=None),
    include_unassigned: bool = Query(default=False),
) -> list[ChatSessionRead]:
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


@router.get("/chat/sessions/{session_id}", response_model=list[ChatMessageRead])
def get_chat_history(
    session_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[ChatMessageRead]:
    """Return chat history for a session."""
    repo = ChatRepository(session)
    session_model = repo.get_session(session_id, user_id=current_user.id)
    if not session_model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    messages = repo.list_messages(session_id)
    return [ChatMessageRead.from_model(message) for message in messages]


@router.post(
    "/chat/sessions/{session_id}/branch",
    response_model=ChatBranchResponse,
    dependencies=[Depends(require_chat_branching_enabled)],
)
def branch_chat_session(
    session_id: UUID,
    payload: ChatBranchCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChatBranchResponse:
    """Create a new chat session branched from a selected message."""
    chat_service = ChatService(session)
    try:
        return chat_service.branch_session(
            user=current_user,
            session_id=session_id,
            message_id=payload.message_id,
            title=payload.title,
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


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
    purge_session_assets(session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/chat/sessions/{session_id}/assets/{asset_path:path}")
def get_chat_asset(
    session_id: UUID,
    asset_path: str,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileResponse:
    """Stream an image the user attached to this session's messages.

    The path is the storage-relative one on the message's attachment
    record; the service scopes it to this session's own directory.
    """
    if not ChatRepository(session).get_session(session_id, user_id=current_user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")
    try:
        resolved = resolve_chat_asset(FileStorage(), session_id, asset_path)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    media_type, _ = mimetypes.guess_type(resolved.name)
    return FileResponse(
        path=resolved,
        media_type=media_type or "application/octet-stream",
        headers={"Content-Disposition": "inline", "X-Content-Type-Options": "nosniff"},
    )
