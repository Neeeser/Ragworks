"""Classification of each provider's real error shapes.

Every exception here is built the way its SDK builds it -- verified against the
installed SDKs: the OpenAI client hands `APIStatusError` the *unwrapped*
`body["error"]` object, Anthropic hands over the whole envelope, Pinecone
carries `status` rather than `status_code` and no response at all, and Cohere,
TEI, and OpenRouter's REST surfaces raise a bare `httpx.HTTPStatusError`. A
fixture that invented a tidier shape would pass while the live path misfiled
every failure.
"""

from __future__ import annotations

import httpx
import pytest
from anthropic import APIStatusError as AnthropicStatusError
from anthropic import OverloadedError
from openai import AuthenticationError, RateLimitError
from pinecone.exceptions import ForbiddenException, PineconeApiException

from app.clients.ollama import OllamaApiError
from app.schemas.provider_errors import ProviderErrorCode as Code
from app.services.provider_errors import classify_provider_error, provider_error

_URL = "https://provider.test/v1/chat/completions"


def _response(status: int, payload: object | None = None) -> httpx.Response:
    request = httpx.Request("POST", _URL)
    if payload is None:
        return httpx.Response(status, request=request)
    return httpx.Response(status, request=request, json=payload)


def _openai(status: int, error: dict[str, object]) -> RateLimitError | AuthenticationError:
    """Build the exception the OpenAI SDK raises for `{"error": error}`.

    The SDK unwraps the envelope before constructing, so `body` is the inner
    error object -- classifying against the envelope instead would never see
    `type` or `code`.
    """
    response = _response(status, {"error": error})
    if status == 401:
        return AuthenticationError("Error code: 401", response=response, body=error)
    return RateLimitError("Error code: 429", response=response, body=error)


def _httpx(status: int, payload: object | None = None) -> httpx.HTTPStatusError:
    """The failure Cohere, TEI, and OpenRouter's REST calls raise."""
    response = _response(status, payload)
    return httpx.HTTPStatusError("boom", request=response.request, response=response)


# --- OpenAI: a billing 429 is indistinguishable from a rate limit by status ---


@pytest.mark.parametrize(
    "error",
    [
        {"message": "You exceeded your current quota.", "type": "insufficient_quota"},
        {"message": "Credits exhausted.", "code": "credit_balance_exhausted"},
        {"message": "Spend limit reached.", "code": "organization_spend_limit_exceeded"},
        {"message": "Project limit reached.", "code": "project_spend_limit_exceeded"},
        {"message": "Usage limit reached.", "code": "organization_usage_limit_exceeded"},
    ],
)
def test_openai_billing_429_classifies_as_quota_not_rate_limit(error: dict[str, object]) -> None:
    """Every OpenAI billing cause arrives as a 429 and must not be retried."""
    detail = classify_provider_error(_openai(429, error))

    assert detail is not None
    assert detail.code is Code.QUOTA_EXHAUSTED
    assert detail.retryable is False
    assert detail.upstream_status == 429


def test_openai_plain_429_stays_a_retryable_rate_limit() -> None:
    """The genuine rate limit keeps retrying -- the distinction has to cut both ways."""
    detail = classify_provider_error(_openai(429, {"message": "Slow down.", "type": "rate_limit"}))

    assert detail is not None
    assert detail.code is Code.RATE_LIMITED
    assert detail.retryable is True


def test_openai_invalid_key_is_authentication() -> None:
    detail = classify_provider_error(
        _openai(401, {"message": "Incorrect API key", "code": "invalid_api_key"})
    )

    assert detail is not None
    assert detail.code is Code.AUTHENTICATION
    assert detail.retryable is False


# --- OpenRouter: 402 for credits, and a canonical error_type beside a lossy one ---


def test_openrouter_402_is_quota_exhausted() -> None:
    error = {"code": 402, "message": "Insufficient credits. Add more and retry."}
    detail = classify_provider_error(_httpx(402, {"error": error}))

    assert detail is not None
    assert detail.code is Code.QUOTA_EXHAUSTED
    assert detail.provider_message == "Insufficient credits. Add more and retry."


def test_openrouter_canonical_error_type_beats_the_native_one() -> None:
    """`error_type` is documented as authoritative; the native type is lossy.

    OpenRouter's Anthropic skin collapses several internal types onto
    `api_error`, so reading whichever token the body listed first would file a
    rate limit as a server fault -- and retry it on the wrong policy.
    """
    body = {
        "error": {
            "code": 429,
            "message": "Rate limit exceeded",
            "type": "api_error",
            "metadata": {"error_type": "rate_limit_exceeded", "provider_code": "rate_limited"},
        }
    }
    detail = classify_provider_error(_httpx(429, body))

    assert detail is not None
    assert detail.code is Code.RATE_LIMITED


def test_openrouter_context_length_is_its_own_code() -> None:
    body = {
        "error": {
            "code": 400,
            "message": "too long",
            "metadata": {"error_type": "context_length_exceeded"},
        }
    }
    detail = classify_provider_error(_httpx(400, body))

    assert detail is not None
    assert detail.code is Code.CONTEXT_LENGTH_EXCEEDED
    assert detail.retryable is False


# --- Anthropic: one error.type per status, on the full envelope ---


def test_anthropic_billing_error_is_quota_exhausted() -> None:
    """402 `billing_error`, wrapped -- the SDK does not unwrap its envelope."""
    body = {"type": "error", "error": {"type": "billing_error", "message": "Check your billing."}}
    exc = AnthropicStatusError("Error code: 402", response=_response(402, body), body=body)

    detail = classify_provider_error(exc)

    assert detail is not None
    assert detail.code is Code.QUOTA_EXHAUSTED
    assert detail.provider == "Anthropic"
    assert detail.provider_message == "Check your billing."


def test_anthropic_529_overloaded_is_retryable() -> None:
    """529 is Anthropic's own overload status and worth backing off from."""
    body = {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
    exc = OverloadedError("Error code: 529", response=_response(529, body), body=body)

    detail = classify_provider_error(exc)

    assert detail is not None
    assert detail.code is Code.UNAVAILABLE
    assert detail.retryable is True


# --- Cohere: status-only, 402 billing vs 429 trial/production rate limit ---


def test_cohere_402_is_quota_and_429_is_a_rate_limit() -> None:
    billing = classify_provider_error(_httpx(402, {"message": "add a payment method"}))
    limited = classify_provider_error(_httpx(429, {"message": "past the per minute request limit"}))

    assert billing is not None
    assert limited is not None
    assert billing.code is Code.QUOTA_EXHAUSTED
    assert billing.retryable is False
    assert limited.code is Code.RATE_LIMITED
    assert limited.retryable is True


# --- Pinecone: `status`, not `status_code`, and no response object ---


def test_pinecone_status_is_read_from_its_own_attribute() -> None:
    """Pinecone spells the status differently, so a status-blind reader retries
    a 403 five times before failing."""
    detail = classify_provider_error(ForbiddenException(status=403, reason="Forbidden"))

    assert detail is not None
    assert detail.upstream_status == 403
    assert detail.code is Code.PERMISSION_DENIED
    assert detail.retryable is False
    assert detail.provider == "Pinecone"


def test_pinecone_402_is_quota_exhausted() -> None:
    detail = classify_provider_error(PineconeApiException(status=402, reason="Payment Required"))

    assert detail is not None
    assert detail.code is Code.QUOTA_EXHAUSTED


# --- Ollama and TEI: self-hosted, so no billing at all ---


def test_ollama_missing_model_is_not_found() -> None:
    detail = classify_provider_error(
        OllamaApiError('model "nomic-embed-text" not found, try pulling it first', status_code=404)
    )

    assert detail is not None
    assert detail.code is Code.NOT_FOUND
    assert detail.provider == "Ollama"
    assert detail.retryable is False


def test_unreachable_self_hosted_server_is_a_connection_failure() -> None:
    """The everyday Ollama/TEI failure: nothing is listening on the URL."""
    detail = classify_provider_error(httpx.ConnectError("connection refused"))

    assert detail is not None
    assert detail.code is Code.CONNECTION
    assert detail.retryable is True
    assert "could not be reached" in detail.message


@pytest.mark.parametrize(
    ("status", "error_type", "expected", "retryable"),
    [
        (429, "Overloaded", Code.RATE_LIMITED, True),
        (503, "Unhealthy", Code.UNAVAILABLE, True),
        (424, "Backend", Code.SERVER_ERROR, True),
        (422, "Validation", Code.INVALID_REQUEST, False),
        (400, "Empty", Code.INVALID_REQUEST, False),
    ],
)
def test_tei_error_type_drives_the_classification(
    status: int, error_type: str, expected: Code, retryable: bool
) -> None:
    """TEI publishes a capitalized `error_type` beside its message."""
    detail = classify_provider_error(_httpx(status, {"error": "boom", "error_type": error_type}))

    assert detail is not None
    assert detail.code is expected
    assert detail.retryable is retryable


# --- The taxonomy's edges ---


def test_our_own_bug_is_never_classified_as_a_provider_failure() -> None:
    """An internal defect must surface as itself, not as "upstream is down"."""
    assert classify_provider_error(KeyError("node_id")) is None


def test_unlisted_5xx_stays_retryable_and_unlisted_4xx_does_not() -> None:
    server = classify_provider_error(_httpx(521))
    client = classify_provider_error(_httpx(451))

    assert server is not None
    assert client is not None
    assert server.retryable is True
    assert client.code is Code.UNKNOWN
    assert client.retryable is False


def test_provider_error_pins_402_for_quota_and_names_the_operation() -> None:
    """The route contract: a payment problem is not a bad gateway."""
    error = provider_error(
        _openai(429, {"message": "You exceeded your current quota.", "type": "insufficient_quota"}),
        context="Ingestion pipeline failed",
    )

    assert error.status_code == 402
    assert error.code is Code.QUOTA_EXHAUSTED
    assert error.provider_detail.message.startswith("Ingestion pipeline failed.")
    assert "Add credit" in error.provider_detail.message
    assert isinstance(error.detail, dict)
    assert error.detail["code"] == "quota_exhausted"


def test_provider_error_keeps_a_rate_limit_at_429() -> None:
    error = provider_error(_httpx(429), context="Chat provider request failed")

    assert error.status_code == 429
    assert error.code is Code.RATE_LIMITED
