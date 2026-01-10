"""Chat schema models for sessions and messages."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.db import models
from app.db.models import ChatMode, ChatRole
from app.schemas.base import DateTimeConfigMixin


class ToolCallTrace(BaseModel):
    """Trace details for tool calls executed during chat."""

    id: str
    name: str
    arguments: Dict[str, Any]
    response: Optional[Dict[str, Any]] = None
    reasoning: Optional[Dict[str, Any]] = None
    collection_id: Optional[UUID] = None
    collection_name: Optional[str] = None


class ChatMessageRead(DateTimeConfigMixin, BaseModel):
    """Message record returned to clients."""

    id: UUID
    session_id: UUID
    role: ChatRole
    content: str
    model: Optional[str]
    tool_name: Optional[str]
    tool_payload: Optional[Dict[str, Any]]
    tool_call_id: Optional[str]
    reasoning_trace: Optional[Dict[str, Any]]
    prompt_tokens: Optional[int]
    completion_tokens: Optional[int]
    usage: Optional[Dict[str, Any]] = None
    source_message_id: Optional[UUID] = None
    created_at: datetime

    @classmethod
    def from_model(cls, message: models.ChatMessage) -> "ChatMessageRead":
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
    context_tokens: int
    tool_collection_ids: List[UUID] = Field(default_factory=list)
    parameter_overrides: Optional[Dict[str, Any]] = None
    provider_preferences: Optional[Dict[str, Any]] = None
    stream: Optional[bool] = False
    branched_from_session_id: Optional[UUID] = None
    branched_from_message_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(
        cls,
        session: models.ChatSession,
        *,
        tool_collection_ids: Optional[List[UUID]] = None,
    ) -> "ChatSessionRead":
        """Build a schema instance from a chat session model."""
        return cls(
            id=session.id,
            user_id=session.user_id,
            title=session.title,
            mode=session.mode,
            chat_model=session.chat_model,
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

    session_id: Optional[UUID] = None
    content: str
    mode: ChatMode = ChatMode.CHAT
    title: Optional[str] = None
    edit_message_id: Optional[UUID] = None
    chat_model: Optional[str] = None
    tool_collection_ids: Optional[List[UUID]] = None
    parameters: Optional[Dict[str, Any]] = None
    provider: Optional[Dict[str, Any]] = None
    stream: Optional[bool] = False


class ChatCompletionResponse(BaseModel):
    """Response payload for chat completions."""

    session: ChatSessionRead
    messages: List[ChatMessageRead]
    tool_traces: List[ToolCallTrace] = Field(default_factory=list)
    usage: Dict[str, Any]
    provider: str
    context_window: int
    context_consumed: int


class ChatBranchCreate(BaseModel):
    """Payload for branching a chat session."""

    message_id: UUID
    title: Optional[str] = None


class ChatBranchResponse(BaseModel):
    """Response payload for a branched chat."""

    session: ChatSessionRead
    messages: List[ChatMessageRead]
