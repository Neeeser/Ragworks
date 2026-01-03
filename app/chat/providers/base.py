"""Provider interfaces and shared request/response models."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Protocol

from app.schemas.models import ModelInfo


@dataclass(frozen=True)
class ParsedChatResponse:
    """Normalized chat response extracted from provider payloads."""

    message: Dict[str, Any]
    usage: Dict[str, Any]
    provider: str
    response_model: Optional[str]


@dataclass(frozen=True)
class ParsedStreamChunk:
    """Normalized streaming delta extracted from provider payloads."""

    provider: Optional[str]
    response_model: Optional[str]
    finish_reason: Optional[str]
    delta_content: Any
    tool_calls: Optional[List[Dict[str, Any]]]
    reasoning: Any
    usage: Optional[Dict[str, Any]]


@dataclass(frozen=True)
class ChatRequest:
    """Chat completion request payload for providers."""

    messages: List[Dict[str, Any]]
    tools: Optional[List[Dict[str, Any]]]
    model: str
    extra_body: Optional[Dict[str, Any]]
    parameters: Optional[Dict[str, Any]]


class ChatProvider(Protocol):
    """Provider interface for chat completion backends."""

    name: str

    def get_model(self, model_id: str) -> Optional[ModelInfo]:
        """Return provider model metadata when available."""

    def chat(self, request: ChatRequest) -> dict:
        """Request a chat completion response."""

    def chat_stream(self, request: ChatRequest) -> Iterable[dict]:
        """Yield streaming chat completion chunks."""

    def parse_chat_response(self, response: dict) -> ParsedChatResponse:
        """Normalize a non-streaming chat response payload."""

    def parse_stream_chunk(self, chunk: dict) -> Optional[ParsedStreamChunk]:
        """Normalize a streaming chunk payload."""
