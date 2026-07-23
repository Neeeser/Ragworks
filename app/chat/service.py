"""Chat service facade wiring setup, the run loop, and tool execution.

`ChatService` owns the request-scoped collaborators (db session, repositories,
provider client, retrieval service) and delegates the real work: setup to
`ChatSetupBuilder`, the chat turn to `run_chat`, tool execution to
`ToolExecutor`, and branching to `branch_session`. `send_message` and
`stream_message` build one `ChatRun` and hand it to the single `run_chat`
implementation (streaming is a parameter, not a fork).
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.chat.branching import branch_session
from app.chat.run_loop import ChatRun, run_chat
from app.chat.setup import ChatSetupBuilder
from app.chat.state import RunState
from app.chat.tools import ToolExecutor
from app.core.config import get_settings
from app.db import models
from app.db.repositories import ChatRepository, CollectionRepository
from app.schemas.chat import (
    ChatBranchResponse,
    ChatCompletionResponse,
    ChatMessageCreate,
)
from app.services.errors import ExternalServiceError, is_external_provider_error
from app.services.tool_invocation import ToolInvocationService


class ChatService:
    """Manage chat sessions, tool calls, and provider interactions."""

    def __init__(self, session: Session) -> None:
        """Initialize the chat service with database and provider clients."""
        self.session = session
        self.settings = get_settings()
        self.chat_repo = ChatRepository(session)
        self.collection_repo = CollectionRepository(session)
        self.invocation = ToolInvocationService(session)
        effort_value = (self.settings.openrouter_reasoning_effort or "").strip()
        self.reasoning_effort: str | None = effort_value or None

    def _build_run(self, *, user: models.User, payload: ChatMessageCreate) -> ChatRun:
        """Resolve setup (including the session's provider) and assemble the run.

        The provider comes off the setup: `ChatSetupBuilder` resolves the
        session's provider connection through the registry, so this facade no
        longer assumes any particular provider type.
        """
        builder = ChatSetupBuilder(
            session=self.session,
            chat_repo=self.chat_repo,
            collection_repo=self.collection_repo,
            reasoning_effort=self.reasoning_effort,
        )
        setup = builder.build(user=user, payload=payload)
        return ChatRun(
            provider=setup.provider,
            setup=setup,
            run_state=RunState(provider=setup.provider.name),
            user=user,
            payload=payload,
            session=self.session,
            chat_repo=self.chat_repo,
            tool_executor=ToolExecutor(
                session=self.session,
                chat_repo=self.chat_repo,
                invocation=self.invocation,
            ),
        )

    def send_message(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
    ) -> ChatCompletionResponse:
        """Send a chat message and return the final response.

        A raw OpenRouter/httpx/Pinecone failure (auth rejection, rate limit,
        outage) is reclassified as `ExternalServiceError` (-> 502) rather than
        propagating to a generic 500 -- the streaming path already surfaces
        the same class of failure as a user-visible `ErrorEvent` via
        `routes/chat.py`'s broad `except Exception`; this gives the
        non-streaming path an equivalent, typed contract.
        """
        try:
            return run_chat(self._build_run(user=user, payload=payload), stream=False)
        except Exception as exc:
            if is_external_provider_error(exc):
                raise ExternalServiceError(f"Chat provider request failed: {exc}") from exc
            raise

    def stream_message(
        self,
        *,
        user: models.User,
        payload: ChatMessageCreate,
    ) -> Generator[dict[str, Any], None, None]:
        """Stream a chat response while yielding intermediate events."""
        return run_chat(self._build_run(user=user, payload=payload), stream=True)

    def branch_session(
        self,
        *,
        user: models.User,
        session_id: UUID,
        message_id: UUID,
        title: str | None,
    ) -> ChatBranchResponse:
        """Create a new chat session branched from a specific message."""
        return branch_session(
            session=self.session,
            chat_repo=self.chat_repo,
            user=user,
            session_id=session_id,
            message_id=message_id,
            title=title,
        )
