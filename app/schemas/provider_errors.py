"""Wire contract for a classified upstream-provider failure.

Every provider distinguishes failures that are worth retrying (congestion,
overload) from failures that will fail identically on every attempt (an
exhausted credit balance, a revoked key, an input past the context window), and
the two need opposite handling. `ProviderErrorCode` is the vocabulary those
distinctions are expressed in; `app/services/provider_errors.py` maps each
provider's published codes onto it, and the frontend renders an action per code
(`frontend/src/lib/types/provider-errors.ts` mirrors this module).
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class ProviderErrorCode(StrEnum):
    """What went wrong upstream, in terms the caller can act on."""

    #: The account is out of credit or past a spend/usage cap. Retrying never
    #: clears it; the account owner adds credit or raises the limit.
    QUOTA_EXHAUSTED = "quota_exhausted"
    #: Requests are arriving faster than the key's tier allows.
    RATE_LIMITED = "rate_limited"
    #: The API key is missing, malformed, revoked, or expired.
    AUTHENTICATION = "authentication"
    #: The key is valid but not allowed to make this request.
    PERMISSION_DENIED = "permission_denied"
    #: The request is malformed or semantically unprocessable.
    INVALID_REQUEST = "invalid_request"
    #: Input plus output exceeds the model's context window.
    CONTEXT_LENGTH_EXCEEDED = "context_length_exceeded"
    #: The request body is over the provider's size limit.
    PAYLOAD_TOO_LARGE = "payload_too_large"
    #: A content filter or safety system blocked the input or the output.
    CONTENT_POLICY = "content_policy"
    #: The named model, index, or resource does not exist.
    NOT_FOUND = "not_found"
    #: The provider did not respond in time.
    TIMEOUT = "timeout"
    #: The provider is overloaded or temporarily unavailable.
    UNAVAILABLE = "unavailable"
    #: The provider reported an internal fault.
    SERVER_ERROR = "server_error"
    #: The provider was unreachable — DNS, TLS, refused connection, dropped
    #: socket. The common failure for a self-hosted Ollama or TEI server.
    CONNECTION = "connection"
    #: A provider failure carrying no code this vocabulary covers.
    UNKNOWN = "unknown"


class ProviderErrorDetail(BaseModel):
    """The `detail` body of an HTTP error caused by an upstream provider."""

    code: ProviderErrorCode = Field(description="Classified failure category.")
    message: str = Field(description="What happened and what the user can do about it.")
    retryable: bool = Field(description="Whether retrying the same request could succeed.")
    provider: str | None = Field(
        default=None,
        description="Provider the failure came from, when the exception identifies one.",
    )
    provider_message: str | None = Field(
        default=None,
        description="The provider's own message, verbatim.",
    )
    upstream_status: int | None = Field(
        default=None,
        description="HTTP status the provider returned, when it returned one.",
    )
