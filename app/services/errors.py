"""Typed domain errors raised by services and translated at the route edge.

Services never raise `HTTPException` (that would make them routes in disguise)
and a bare `ValueError` is not an API contract -- the status code it maps to is
invisible at the raise site and easy to get wrong. Instead services raise one of
the three errors below and routes translate them with `to_http_exception`
(`app/api/routes/utils.py`):

- `NotFoundError`        -> 404
- `InvalidInputError`    -> 400
- `ExternalServiceError` -> 502

`detail` is carried through verbatim to the `HTTPException`, so it may be a plain
message string or the structured `dict` the settings endpoint returns for
per-field validation errors.
"""

from __future__ import annotations

import httpx
from openai import OpenAIError
from pinecone.exceptions import PineconeException

from app.clients.ollama import OllamaApiError

_EXTERNAL_PROVIDER_ERRORS: tuple[type[Exception], ...] = (
    httpx.HTTPError,
    OpenAIError,
    PineconeException,
    OllamaApiError,
)


def is_external_provider_error(exc: Exception) -> bool:
    """Return True when `exc` originates from a Pinecone/OpenRouter/Ollama client call.

    Used at service boundaries that run pipeline nodes talking to those
    providers (`RetrievalService`, `IngestionService`): a genuine upstream
    fault (rate limit, auth rejection, network failure) should surface as a
    502 via `ExternalServiceError`, but a bug in *our* node logic should not
    be misreported as an upstream failure, so this only matches the SDK/HTTP
    exception families those clients actually raise -- never a bare
    `isinstance(exc, Exception)`.
    """
    return isinstance(exc, _EXTERNAL_PROVIDER_ERRORS)


class ServiceError(Exception):
    """Base for domain errors that a route translates into an HTTP response."""

    def __init__(self, detail: str | dict[str, str]) -> None:
        """Store the wire detail and a readable message for logging/tests."""
        super().__init__(detail if isinstance(detail, str) else str(detail))
        self.detail: str | dict[str, str] = detail


class NotFoundError(ServiceError):
    """A requested resource does not exist (or is not visible to the caller)."""


class InvalidInputError(ServiceError):
    """The request is well-formed but semantically invalid (maps to 400)."""


class ExternalServiceError(ServiceError):
    """An upstream provider (Pinecone, OpenRouter) failed (maps to 502)."""
