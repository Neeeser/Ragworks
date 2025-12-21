from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

NumberLike = int | float | str


class OpenRouterUsage(BaseModel):
    model_config = ConfigDict(extra="allow")

    prompt_tokens: Optional[NumberLike] = None
    completion_tokens: Optional[NumberLike] = None
    total_tokens: Optional[NumberLike] = None
    completion_tokens_details: Optional[Dict[str, Any]] = None
    prompt_tokens_details: Optional[Dict[str, Any]] = None
    reasoning_tokens: Optional[NumberLike] = None
    cost: Optional[NumberLike] = None


class OpenRouterFunctionCall(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: Optional[str] = None
    arguments: Optional[str] = None
    id: Optional[str] = None


class OpenRouterToolCall(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: Optional[str] = None
    type: Optional[str] = None
    function: Optional[OpenRouterFunctionCall] = None
    index: Optional[int] = None


class OpenRouterAssistantMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    content: Optional[Any] = None
    tool_calls: Optional[List[OpenRouterToolCall]] = None
    reasoning: Optional[Any] = None
    reasoning_content: Optional[Any] = None


class OpenRouterChatChoice(BaseModel):
    model_config = ConfigDict(extra="allow")

    index: Optional[int] = None
    message: Optional[OpenRouterAssistantMessage] = None
    finish_reason: Optional[str] = None


class OpenRouterChatResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: Optional[str] = None
    choices: List[OpenRouterChatChoice] = Field(default_factory=list)
    model: Optional[str] = None
    provider: Optional[str] = None
    usage: Optional[OpenRouterUsage] = None


class OpenRouterStreamDelta(BaseModel):
    model_config = ConfigDict(extra="allow")

    content: Optional[Any] = None
    tool_calls: Optional[List[OpenRouterToolCall]] = None
    reasoning: Optional[Any] = None


class OpenRouterStreamChoice(BaseModel):
    model_config = ConfigDict(extra="allow")

    index: Optional[int] = None
    delta: Optional[OpenRouterStreamDelta] = None
    finish_reason: Optional[str] = None


class OpenRouterStreamChunk(BaseModel):
    model_config = ConfigDict(extra="allow")

    choices: List[OpenRouterStreamChoice] = Field(default_factory=list)
    provider: Optional[str] = None
    model: Optional[str] = None
    usage: Optional[OpenRouterUsage] = None


class OpenRouterEmbeddingItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    object: Optional[str] = None
    embedding: Optional[Any] = None
    index: Optional[int] = None


class OpenRouterEmbeddingsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: Optional[str] = None
    object: Optional[str] = None
    data: Optional[List[OpenRouterEmbeddingItem]] = None
    model: Optional[str] = None
    usage: Optional[OpenRouterUsage] = None
