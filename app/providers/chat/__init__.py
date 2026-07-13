"""Chat provider implementations and interfaces.

These live in the provider layer (not `app/chat`) so that adapter modules can
construct them without importing the chat subsystem — `app.chat` depends on
`app.providers`, never the reverse.
"""

from app.providers.chat.base import (
    ChatProvider,
    ChatRequest,
    ParsedChatResponse,
    ParsedStreamChunk,
)
from app.providers.chat.ollama import OllamaChatProvider
from app.providers.chat.openrouter import OpenRouterProvider

__all__ = [
    "ChatProvider",
    "ChatRequest",
    "OllamaChatProvider",
    "OpenRouterProvider",
    "ParsedChatResponse",
    "ParsedStreamChunk",
]
