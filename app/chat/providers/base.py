"""Provider interfaces and shared request/response models."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Protocol

from app.schemas.models import ModelInfo


@dataclass(frozen=True)
class ParsedChatResponse:
    """Normalized chat response extracted from provider payloads."""

    message: dict[str, Any]
    usage: dict[str, Any]
    provider: str
    response_model: str | None


@dataclass(frozen=True)
class ParsedStreamChunk:
    """Normalized streaming delta extracted from provider payloads."""

    provider: str | None
    response_model: str | None
    finish_reason: str | None
    delta_content: Any
    tool_calls: list[dict[str, Any]] | None
    reasoning: Any
    usage: dict[str, Any] | None


@dataclass(frozen=True)
class ChatRequest:
    """Chat completion request payload for providers."""

    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]] | None
    model: str
    extra_body: dict[str, Any] | None
    parameters: dict[str, Any] | None


class ChatProvider(Protocol):
    """Provider interface for chat completion backends."""

    name: str

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return provider model metadata when available."""

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Request a chat completion response."""

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Yield streaming chat completion chunks."""

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize a non-streaming chat response payload."""

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize a streaming chunk payload."""
