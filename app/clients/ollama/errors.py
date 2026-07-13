"""Error type for the Ollama client, shared by the transport and the catalog."""

from __future__ import annotations


class OllamaApiError(RuntimeError):
    """An error reported by the Ollama server (HTTP or in-band `error` field)."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        """Store the provider message and optional HTTP status."""
        super().__init__(message)
        self.status_code = status_code
