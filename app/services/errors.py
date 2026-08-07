"""Typed domain errors raised by services and translated at the route edge.

Services never raise `HTTPException` (that would make them routes in disguise)
and a bare `ValueError` is not an API contract -- the status code it maps to is
invisible at the raise site and easy to get wrong. Instead services raise one of
the three errors below and routes translate them with `to_http_exception`
(`app/api/routes/utils.py`):

- `NotFoundError`        -> 404
- `InvalidInputError`    -> 400
- `ExternalServiceError` -> 502
- `ProviderError`        -> the status its `ProviderErrorCode` maps to

`detail` is carried through verbatim to the `HTTPException`, so it may be a plain
message string or the structured `dict` the settings endpoint returns for
per-field validation errors.
"""

from __future__ import annotations

from collections.abc import Mapping

import httpx
from anthropic import AnthropicError
from openai import OpenAIError
from pinecone.exceptions import PineconeException

from app.clients.ollama import OllamaApiError
from app.schemas.provider_errors import ProviderErrorCode, ProviderErrorDetail

_EXTERNAL_PROVIDER_ERRORS: tuple[type[Exception], ...] = (
    httpx.HTTPError,
    AnthropicError,
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
    """Base for domain errors that a route translates into an HTTP response.

    `status_code` pins the HTTP status when the type-based mapping in
    `to_http_exception` is not expressive enough -- a retrieval pipeline
    failure carries structured detail but must surface as a 502 (upstream) or a
    500 (internal bug) depending on the underlying cause, a distinction the
    error *type* alone cannot make. Left `None`, the type mapping decides.
    """

    def __init__(
        self,
        detail: str | Mapping[str, object],
        *,
        status_code: int | None = None,
    ) -> None:
        """Store the wire detail and a readable message for logging/tests."""
        super().__init__(detail if isinstance(detail, str) else str(detail))
        self.detail: str | Mapping[str, object] = detail
        self.status_code: int | None = status_code


class NotFoundError(ServiceError):
    """A requested resource does not exist (or is not visible to the caller)."""


class InvalidInputError(ServiceError):
    """The request is well-formed but semantically invalid (maps to 400)."""


class InvalidQueryArgumentsError(InvalidInputError):
    """Supplied query arguments violate the pipeline's declarations.

    Distinguished from other 400s so chat tool execution can feed the
    violation back to the model as a tool error (the model chose the values
    and can retry) instead of failing the whole turn on a config problem.
    """


class ExternalServiceError(ServiceError):
    """An upstream provider (Pinecone, OpenRouter) failed (maps to 502)."""


#: Statuses that carry meaning no client can misread. Everything else keeps the
#: `ExternalServiceError` 502 and is told apart by `ProviderErrorDetail.code` --
#: a provider's rejected API key surfacing as our own 401 would read to the
#: frontend as an expired session and sign the user out.
_CODE_STATUS: dict[ProviderErrorCode, int] = {
    ProviderErrorCode.QUOTA_EXHAUSTED: 402,
    ProviderErrorCode.RATE_LIMITED: 429,
}


def provider_error_status(code: ProviderErrorCode) -> int:
    """HTTP status a classified provider failure maps to."""
    return _CODE_STATUS.get(code, 502)


class ProviderError(ExternalServiceError):
    """An upstream failure classified into an actionable `ProviderErrorCode`.

    A subclass of `ExternalServiceError` so every existing upstream handler
    still catches it, while `detail` carries the structured
    `ProviderErrorDetail` the frontend renders an action from. Built by
    `app/services/provider_errors.py`, which owns the per-provider mapping;
    construct it there rather than guessing a code at a raise site.
    """

    def __init__(self, detail: ProviderErrorDetail) -> None:
        """Pin the status the code maps to and keep the structured detail."""
        super().__init__(
            detail.model_dump(mode="json"),
            status_code=provider_error_status(detail.code),
        )
        self.code = detail.code
        self.provider_detail = detail
