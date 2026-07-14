"""Typed client for the official Ollama API."""

from app.clients.ollama.catalog import OllamaCatalog
from app.clients.ollama.client import OllamaClient, get_ollama_client
from app.clients.ollama.errors import OllamaApiError

__all__ = ["OllamaApiError", "OllamaCatalog", "OllamaClient", "get_ollama_client"]
