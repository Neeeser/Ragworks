"""Typed client for the official Ollama API."""

from app.clients.ollama.catalog import OllamaCatalog
from app.clients.ollama.client import (
    OllamaClient,
    close_ollama_clients,
    get_ollama_client,
    invalidate_ollama_client,
)
from app.clients.ollama.errors import OllamaApiError

__all__ = [
    "OllamaApiError",
    "OllamaCatalog",
    "OllamaClient",
    "close_ollama_clients",
    "get_ollama_client",
    "invalidate_ollama_client",
]
