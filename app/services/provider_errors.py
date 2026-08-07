"""Map a provider's own error codes onto the `ProviderErrorCode` vocabulary.

Providers publish machine-readable codes precisely so a caller can tell a
failure it should retry from one it should not. Reading only the HTTP status
loses that: OpenAI answers an exhausted credit balance with the same 429 it
uses for genuine rate limiting, so a status-only rule spends the full backoff
schedule on a request that cannot succeed and then reports "upstream is busy"
to a user whose actual problem is a payment page.

Each table below is transcribed from that provider's current published error
reference -- never from memory, because these vocabularies change (OpenAI's
billing codes are `error.code` values alongside an `insufficient_quota`
`error.type`, and the code set has grown). Sources:

- OpenRouter  `docs/external-api/openrouter/api_reference/errors-and-debugging.md`
  ("Typed error codes"): the fullest vocabulary, carried as `error_type` on the
  response body and on mid-stream SSE events.
- OpenAI      developers.openai.com/api/docs/guides/error-codes: billing causes
  are 429s told apart by `error.code`; `error.type` may still be
  `insufficient_quota`.
- Anthropic   platform.claude.com/docs/en/api/errors: one `error.type` per
  status, including 402 `billing_error`.
- Cohere      docs.cohere.com/reference/errors: status-only -- 402 is billing,
  429 is the trial/production rate limit.
- Pinecone    `docs/external-api/pinecone/reference/api/errors.md`: status-only;
  402 is delinquent payment, and 403 covers *both* an exceeded object quota and
  index deletion protection, so it stays `PERMISSION_DENIED` and the provider's
  own message says which.
- Ollama      github.com/ollama/ollama `docs/api.md`: a local server with no
  billing; errors are a status plus a free-text `error` string.
- TEI         huggingface/text-embeddings-inference `router/src/http/server.rs`:
  an `error_type` enum (`Unhealthy`/`Backend`/`Overloaded`/`Validation`/
  `Tokenizer`/`Empty`) beside the message; self-hosted, so no billing either.
"""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping

from anthropic import AnthropicError
from pinecone.exceptions import PineconeException

from app.clients.ollama import OllamaApiError
from app.schemas.provider_errors import ProviderErrorCode, ProviderErrorDetail
from app.services.errors import ProviderError, is_external_provider_error

_C = ProviderErrorCode

#: Machine-readable codes, keyed by the exact token providers publish. Read from
#: `type`, `code`, and `error_type` wherever they appear in the error body, so a
#: token match is always a provider's own classification -- never a substring of
#: a free-text message, which would misfire on the word "quota" in prose.
_TOKEN_CODES: dict[str, ProviderErrorCode] = {
    # OpenAI -- billing and quota. All arrive as HTTP 429.
    "insufficient_quota": _C.QUOTA_EXHAUSTED,
    "credit_balance_exhausted": _C.QUOTA_EXHAUSTED,
    "organization_spend_limit_exceeded": _C.QUOTA_EXHAUSTED,
    "project_spend_limit_exceeded": _C.QUOTA_EXHAUSTED,
    "organization_usage_limit_exceeded": _C.QUOTA_EXHAUSTED,
    # OpenAI -- request-level codes.
    "invalid_api_key": _C.AUTHENTICATION,
    "model_not_found": _C.NOT_FOUND,
    "content_filter": _C.CONTENT_POLICY,
    "string_above_max_length": _C.PAYLOAD_TOO_LARGE,
    # Anthropic -- one `error.type` per status.
    "billing_error": _C.QUOTA_EXHAUSTED,
    "authentication_error": _C.AUTHENTICATION,
    "permission_error": _C.PERMISSION_DENIED,
    "not_found_error": _C.NOT_FOUND,
    "conflict_error": _C.INVALID_REQUEST,
    "request_too_large": _C.PAYLOAD_TOO_LARGE,
    "rate_limit_error": _C.RATE_LIMITED,
    "invalid_request_error": _C.INVALID_REQUEST,
    "api_error": _C.SERVER_ERROR,
    "timeout_error": _C.TIMEOUT,
    "overloaded_error": _C.UNAVAILABLE,
    # OpenRouter -- the `error_type` vocabulary.
    "payment_required": _C.QUOTA_EXHAUSTED,
    # Documented as "a token budget enforced by OpenRouter (e.g. credit-based
    # cap)", so it is an account limit rather than a per-request one.
    "token_limit_exceeded": _C.QUOTA_EXHAUSTED,
    "authentication": _C.AUTHENTICATION,
    "permission_denied": _C.PERMISSION_DENIED,
    "rate_limit_exceeded": _C.RATE_LIMITED,
    "provider_overloaded": _C.UNAVAILABLE,
    "provider_unavailable": _C.UNAVAILABLE,
    "context_length_exceeded": _C.CONTEXT_LENGTH_EXCEEDED,
    "max_tokens_exceeded": _C.CONTEXT_LENGTH_EXCEEDED,
    "string_too_long": _C.PAYLOAD_TOO_LARGE,
    "payload_too_large": _C.PAYLOAD_TOO_LARGE,
    "invalid_request": _C.INVALID_REQUEST,
    "invalid_prompt": _C.INVALID_REQUEST,
    "unprocessable": _C.INVALID_REQUEST,
    "precondition_failed": _C.INVALID_REQUEST,
    "not_found": _C.NOT_FOUND,
    "content_policy_violation": _C.CONTENT_POLICY,
    "refusal": _C.CONTENT_POLICY,
    "server": _C.SERVER_ERROR,
    "timeout": _C.TIMEOUT,
    "unmapped": _C.UNKNOWN,
    # OpenRouter -- image rejections. We send images on multimodal pipelines, and
    # every one of these is fixed by changing the input, so they classify as an
    # invalid request and the provider's message names the offending image.
    "invalid_image": _C.INVALID_REQUEST,
    "image_too_large": _C.PAYLOAD_TOO_LARGE,
    "image_too_small": _C.INVALID_REQUEST,
    "unsupported_image_format": _C.INVALID_REQUEST,
    "image_not_found": _C.NOT_FOUND,
    "image_download_failed": _C.INVALID_REQUEST,
    # TEI -- `error_type`, matched lowercased.
    "unhealthy": _C.UNAVAILABLE,
    "backend": _C.SERVER_ERROR,
    "overloaded": _C.RATE_LIMITED,
    "validation": _C.INVALID_REQUEST,
    "tokenizer": _C.INVALID_REQUEST,
    "empty": _C.INVALID_REQUEST,
}

#: Status fallback for a provider that publishes no code for this failure
#: (Cohere, Pinecone, Ollama) or returns one this table has not seen. Every
#: provider in play agrees on these meanings; 402 is billing everywhere it is
#: used (OpenRouter, Anthropic, Cohere, Pinecone).
_STATUS_CODES: dict[int, ProviderErrorCode] = {
    400: _C.INVALID_REQUEST,
    401: _C.AUTHENTICATION,
    402: _C.QUOTA_EXHAUSTED,
    403: _C.PERMISSION_DENIED,
    404: _C.NOT_FOUND,
    408: _C.TIMEOUT,
    409: _C.INVALID_REQUEST,
    412: _C.INVALID_REQUEST,
    413: _C.PAYLOAD_TOO_LARGE,
    422: _C.INVALID_REQUEST,
    424: _C.SERVER_ERROR,
    429: _C.RATE_LIMITED,
    502: _C.UNAVAILABLE,
    503: _C.UNAVAILABLE,
    504: _C.TIMEOUT,
    # Anthropic's overload status, and Cloudflare's in front of several providers.
    529: _C.UNAVAILABLE,
}

#: Codes where the same request can succeed on a later attempt. Quota
#: exhaustion is deliberately absent: it fails identically every time, so
#: retrying it only adds the full backoff schedule to a certain failure.
RETRYABLE_CODES: frozenset[ProviderErrorCode] = frozenset(
    {
        _C.RATE_LIMITED,
        _C.UNAVAILABLE,
        _C.SERVER_ERROR,
        _C.TIMEOUT,
        _C.CONNECTION,
    }
)

_ACTIONS: dict[ProviderErrorCode, str] = {
    _C.QUOTA_EXHAUSTED: (
        "the account behind this connection has no credit or quota left. "
        "Add credit or raise the spend limit for its API key, then retry."
    ),
    _C.RATE_LIMITED: (
        "this key is being rate limited. Lower the connection's requests-per-minute "
        "or wait before retrying."
    ),
    _C.AUTHENTICATION: "the API key was rejected. Check the key on this connection.",
    _C.PERMISSION_DENIED: (
        "the API key is not allowed to make this request. Check the key's "
        "permissions and model access."
    ),
    _C.INVALID_REQUEST: "the request was rejected as invalid.",
    _C.CONTEXT_LENGTH_EXCEEDED: (
        "the input exceeds the model's context window. Shorten the input, "
        "retrieve fewer chunks, or pick a model with a larger window."
    ),
    _C.PAYLOAD_TOO_LARGE: "the request body is over the provider's size limit. Send less per call.",
    _C.CONTENT_POLICY: "a content filter blocked the request.",
    _C.NOT_FOUND: (
        "the requested model or resource does not exist. It may have been "
        "retired -- pick another."
    ),
    _C.TIMEOUT: "the request timed out.",
    _C.UNAVAILABLE: "the service is overloaded or unavailable. Retry shortly.",
    _C.SERVER_ERROR: "the service reported an internal error.",
    _C.CONNECTION: (
        "the server could not be reached. Check that it is running and that "
        "the connection's URL is correct."
    ),
    _C.UNKNOWN: "it returned an error code this app does not recognize.",
}

#: Read in this order, because a provider that publishes both a canonical code
#: and a native one documents the canonical as authoritative -- OpenRouter's
#: Anthropic skin carries a lossy `error.type` beside the precise `error_type`,
#: and picking whichever the body happened to list first classifies at random.
_TOKEN_FIELDS = ("error_type", "code", "type")

#: Providers identifiable from the exception family alone. The OpenAI SDK and
#: bare httpx serve several providers each (OpenRouter, OpenAI, and any
#: OpenAI-compatible server share one transport), so they stay unlabelled rather
#: than claim the wrong vendor.
_PROVIDER_LABELS: tuple[tuple[type[Exception], str], ...] = (
    (PineconeException, "Pinecone"),
    (AnthropicError, "Anthropic"),
    (OllamaApiError, "Ollama"),
)


def provider_status(exc: Exception) -> int | None:
    """Best-effort HTTP status from the SDK/HTTP exception families.

    Pinecone spells it `status` rather than `status_code` and attaches no
    response object, so reading only the two common spellings leaves every
    Pinecone failure looking like a transport fault -- and therefore retryable,
    including a 401 that will be rejected identically five times.
    """
    for attr in ("status_code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int):
            return value
    response = getattr(exc, "response", None)
    value = getattr(response, "status_code", None)
    return value if isinstance(value, int) else None


def _error_body(exc: Exception) -> object | None:
    """The provider's parsed error body, from wherever its client keeps it.

    The OpenAI and Anthropic SDKs park it on `body`, Pinecone keeps the raw
    response bytes there, and a bare httpx failure carries only the response.
    """
    body: object | None = getattr(exc, "body", None)
    if isinstance(body, bytes | str):
        try:
            parsed: object = json.loads(body)
        except ValueError:
            return None
        return parsed
    if body is not None:
        return body
    response = getattr(exc, "response", None)
    if response is None:
        return None
    try:
        decoded: object = response.json()
    except (ValueError, RuntimeError):
        # A streamed response that was never read, or a non-JSON body.
        return None
    return decoded


def _scopes(body: object) -> Iterator[Mapping[str, object]]:
    """Yield every mapping in the body that can carry a classification token.

    The SDKs unwrap inconsistently -- OpenAI hands over the inner `error`
    object, Anthropic and raw httpx hand over the envelope -- and OpenRouter
    nests its `error_type` one level deeper again, under `error.metadata`.
    """
    if not isinstance(body, Mapping):
        return
    yield body
    for key in ("error", "metadata"):
        nested = body.get(key)
        if isinstance(nested, Mapping):
            yield from _scopes(nested)


def _tokens(body: object) -> list[str]:
    """Classification tokens the body states, most authoritative field first."""
    scopes = list(_scopes(body))
    found: list[str] = []
    for key in _TOKEN_FIELDS:
        for scope in scopes:
            value = scope.get(key)
            if isinstance(value, str) and value.strip():
                token = value.strip().lower()
                if token not in found:
                    found.append(token)
    return found


def _provider_message(exc: Exception, body: object) -> str:
    """The provider's own message, preferring the body over the repr."""
    for scope in _scopes(body):
        message = scope.get("message") or scope.get("error")
        if isinstance(message, str) and message.strip():
            return message.strip()
    return str(exc).strip()


def _provider_label(exc: Exception) -> str | None:
    """Vendor name when the exception family names exactly one."""
    for family, label in _PROVIDER_LABELS:
        if isinstance(exc, family):
            return label
    return None


def _code_for(status: int | None, tokens: list[str]) -> ProviderErrorCode:
    """Classify from the provider's own token first, its status second."""
    for token in tokens:
        code = _TOKEN_CODES.get(token)
        if code is not None:
            return code
    if status is None:
        return _C.CONNECTION
    mapped = _STATUS_CODES.get(status)
    if mapped is not None:
        return mapped
    # An unlisted 5xx is still the provider's fault and still worth a retry; an
    # unlisted 4xx is our request and will be rejected the same way every time.
    return _C.SERVER_ERROR if status >= 500 else _C.UNKNOWN


def classify_provider_error(exc: Exception) -> ProviderErrorDetail | None:
    """Classify an upstream failure, or return None if `exc` isn't one.

    Returning None (rather than an `UNKNOWN` detail) keeps the existing
    guarantee that a bug in our own code never surfaces as an upstream fault.
    """
    if not is_external_provider_error(exc):
        return None
    body = _error_body(exc)
    status = provider_status(exc)
    code = _code_for(status, _tokens(body))
    provider = _provider_label(exc)
    subject = f"{provider} rejected the request" if provider else "The provider rejected the request"
    if code is _C.CONNECTION:
        subject = f"Could not reach {provider}" if provider else "Could not reach the provider"
    return ProviderErrorDetail(
        code=code,
        message=f"{subject}: {_ACTIONS[code]}",
        retryable=code in RETRYABLE_CODES,
        provider=provider,
        provider_message=_provider_message(exc, body) or None,
        upstream_status=status,
    )


def provider_error(exc: Exception, *, context: str) -> ProviderError:
    """Build the domain error for an upstream failure, prefixed with `context`.

    `context` names the operation the user was performing ("Chat provider
    request failed"), because the classified message describes the provider's
    refusal and not which of our features hit it.

    The provider's own sentence is appended, because these call sites have
    nowhere else to show it: on a rejected parameter or an unsupported input
    that sentence names the exact field to change, and there is no
    strip-and-retry layer to recover from losing it. A surface that *does*
    carry the raw text elsewhere (retrieval links its run trace) composes from
    `classify_provider_error` instead, so the primary message stays readable.
    """
    detail = classify_provider_error(exc)
    if detail is None:
        # Not an upstream failure at all. Report it as what it is rather than
        # blaming a provider -- callers gate on `is_external_provider_error`,
        # so this keeps the function total without inventing an upstream fault.
        return ProviderError(
            ProviderErrorDetail(
                code=_C.UNKNOWN,
                message=f"{context}.",
                retryable=False,
                provider_message=str(exc).strip() or None,
            )
        )
    upstream = f" ({detail.provider_message})" if detail.provider_message else ""
    return ProviderError(
        detail.model_copy(update={"message": f"{context}. {detail.message}{upstream}"})
    )
