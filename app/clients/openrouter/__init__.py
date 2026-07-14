"""Typed OpenRouter client package: HTTP/SDK client + model catalog."""

from __future__ import annotations

from app.clients.openrouter.catalog import ModelCatalog
from app.clients.openrouter.client import (
    OpenRouterClient,
    close_openrouter_clients,
    get_openrouter_client,
    invalidate_openrouter_client,
)

__all__ = [
    "ModelCatalog",
    "OpenRouterClient",
    "close_openrouter_clients",
    "get_openrouter_client",
    "invalidate_openrouter_client",
]
