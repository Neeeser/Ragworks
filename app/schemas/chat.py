from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.db.models import ChatMode, ChatRole


class ToolCallTrace(BaseModel):
    id: str
    name: str
    arguments: Dict[str, Any]
    response: Optional[Dict[str, Any]] = None


class ChatMessageRead(BaseModel):
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
    created_at: datetime


class ChatSessionRead(BaseModel):
    id: UUID
    collection_id: UUID
    user_id: UUID
    title: str
    mode: ChatMode
    chat_model: str
    context_tokens: int
    created_at: datetime
    updated_at: datetime


class ChatMessageCreate(BaseModel):
    session_id: Optional[UUID] = None
    content: str
    mode: ChatMode = ChatMode.CHAT
    title: Optional[str] = None


class ChatCompletionResponse(BaseModel):
    session: ChatSessionRead
    messages: List[ChatMessageRead]
    tool_traces: List[ToolCallTrace] = Field(default_factory=list)
    usage: Dict[str, Any]
    provider: str
    context_window: int
    context_consumed: int


class CollectionQueryRequest(BaseModel):
    query: str
    top_k: int = 5


class CollectionQueryResponse(BaseModel):
    query: str
    top_k: int
    chunks: List[Dict[str, Any]]
    usage: Dict[str, Any]
