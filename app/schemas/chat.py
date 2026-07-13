"""Chat schema models for sessions and messages."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin
from app.schemas.chat_parameters import ChatParameters, ProviderPreferences
from app.schemas.enums import ChatMode, ChatRole

if TYPE_CHECKING:
    from app.db import models


class ToolCallTrace(BaseModel):
    """Trace details for tool calls executed during chat."""

    id: str
    name: str
    arguments: dict[str, Any]
    response: dict[str, Any] | None = None
    reasoning: dict[str, Any] | None = None
    collection_id: UUID | None = None
    collection_name: str | None = None


class ChatMessageRead(DateTimeConfigMixin, BaseModel):
    """Message record returned to clients."""

    id: UUID
    session_id: UUID
    role: ChatRole
    content: str
    model: str | None
    tool_name: str | None
    tool_payload: dict[str, Any] | None
    tool_call_id: str | None
    reasoning_trace: dict[str, Any] | None
    prompt_tokens: int | None
    completion_tokens: int | None
    usage: dict[str, Any] | None = None
    source_message_id: UUID | None = None
    created_at: datetime

    @classmethod
    def from_model(cls, message: models.ChatMessage) -> ChatMessageRead:
        """Build a schema instance from a chat message model."""
        return cls(
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
            source_message_id=message.source_message_id,
            created_at=message.created_at,
        )


class ChatSessionRead(DateTimeConfigMixin, BaseModel):
    """Chat session record returned to clients."""

    id: UUID
    user_id: UUID
    title: str
    mode: ChatMode
    chat_model: str
    provider_connection_id: UUID | None = None
    context_tokens: int
    tool_collection_ids: list[UUID] = Field(default_factory=list)
    parameter_overrides: dict[str, Any] | None = None
    provider_preferences: dict[str, Any] | None = None
    stream: bool | None = False
    branched_from_session_id: UUID | None = None
    branched_from_message_id: UUID | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(
        cls,
        session: models.ChatSession,
        *,
        tool_collection_ids: list[UUID] | None = None,
    ) -> ChatSessionRead:
        """Build a schema instance from a chat session model."""
        return cls(
            id=session.id,
            user_id=session.user_id,
            title=session.title,
            mode=session.mode,
            chat_model=session.chat_model,
            provider_connection_id=session.provider_connection_id,
            context_tokens=session.context_tokens,
            tool_collection_ids=tool_collection_ids or [],
            parameter_overrides=session.parameter_overrides,
            provider_preferences=session.provider_preferences,
            stream=session.stream,
            branched_from_session_id=session.branched_from_session_id,
            branched_from_message_id=session.branched_from_message_id,
            created_at=session.created_at,
            updated_at=session.updated_at,
        )


class ChatMessageCreate(BaseModel):
    """Payload for creating or editing chat messages."""

    session_id: UUID | None = None
    content: str
    mode: ChatMode = ChatMode.CHAT
    title: str | None = None
    edit_message_id: UUID | None = None
    chat_model: str | None = None
    provider_connection_id: UUID | None = None
    tool_collection_ids: list[UUID] | None = None
    parameters: ChatParameters | None = None
    provider: ProviderPreferences | None = None
    stream: bool | None = False


class ChatCompletionResponse(BaseModel):
    """Response payload for chat completions."""

    session: ChatSessionRead
    messages: list[ChatMessageRead]
    tool_traces: list[ToolCallTrace] = Field(default_factory=list)
    usage: dict[str, Any]
    provider: str
    context_window: int
    context_consumed: int


class ChatBranchCreate(BaseModel):
    """Payload for branching a chat session."""

    message_id: UUID
    title: str | None = None


class ChatBranchResponse(BaseModel):
    """Response payload for a branched chat."""

    session: ChatSessionRead
    messages: list[ChatMessageRead]
