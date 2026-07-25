"""Streamable HTTP transport rules for the MCP endpoint.

This module owns every HTTP-level requirement the MCP spec places on a
Streamable HTTP server, so the route stays a thin shell and each rule has one
enforcement site:

- `Origin` is validated on every request (DNS-rebinding defense); a foreign
  origin is 403, per the 2025-11-25 clarification. Non-browser clients send no
  `Origin` at all, which is allowed.
- `MCP-Protocol-Version` is negotiated; an unsupported value is 400. Absent, it
  means 2025-03-26 (the spec's backwards-compatibility assumption).
- `Accept` must permit `application/json`, because that is the only content
  type this server ever returns. We are deliberately *not* strict about the
  spec's client-side "also list text/event-stream" rule: we never open an SSE
  stream, so rejecting a client that omits it would break interoperability
  without protecting anything.
- Responses are single JSON objects, and notifications answer 202 with no body
  — both explicitly permitted, and what makes this server stateless (no
  `Mcp-Session-Id` is ever issued, so clients never have one to send back).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from pydantic import ValidationError

from app.mcp.errors import INVALID_REQUEST, PARSE_ERROR, ProtocolError, TransportError
from app.schemas.mcp import (
    FALLBACK_PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    JsonRpcErrorBody,
    JsonRpcErrorResponse,
    JsonRpcRequest,
    JsonRpcSuccessResponse,
    McpModel,
)


def negotiate_header_version(header: str | None) -> str:
    """Return the protocol version a request is speaking.

    An absent header means 2025-03-26; an unsupported one is a 400 the spec
    requires, so a client cannot silently assume a version we do not honor.
    """
    if header is None or not header.strip():
        return FALLBACK_PROTOCOL_VERSION
    version = header.strip()
    if version not in SUPPORTED_PROTOCOL_VERSIONS:
        raise TransportError(
            400,
            f"Unsupported MCP-Protocol-Version '{version}'. "
            f"Supported: {', '.join(SUPPORTED_PROTOCOL_VERSIONS)}.",
        )
    return version


def negotiate_initialize_version(requested: str | None) -> str:
    """Return the version to report from `initialize`.

    The client's request is echoed when we speak it; otherwise we answer with
    the newest version we support and leave the client to accept or disconnect.
    """
    if requested and requested in SUPPORTED_PROTOCOL_VERSIONS:
        return requested
    return SUPPORTED_PROTOCOL_VERSIONS[0]


def require_json_acceptable(accept: str | None) -> None:
    """Reject a client that cannot accept the JSON responses we return."""
    if accept is None or not accept.strip():
        return
    media_types = {part.split(";")[0].strip().lower() for part in accept.split(",")}
    if media_types & {"application/json", "*/*", "application/*"}:
        return
    raise TransportError(
        406,
        "This endpoint returns application/json; the Accept header must allow it.",
    )


def validate_origin(origin: str | None, allowed_origins: Sequence[str]) -> None:
    """Reject a browser-originated request from an untrusted origin.

    A missing `Origin` is normal for agent harnesses (they are not browsers)
    and is allowed; a present one must be configured, which is what stops a
    web page from driving a locally reachable MCP server.
    """
    if origin is None or not origin.strip():
        return
    permitted = {value.strip().rstrip("/") for value in allowed_origins}
    if "*" in permitted or origin.strip().rstrip("/") in permitted:
        return
    raise TransportError(403, "Origin not allowed.")


def parse_message(body: bytes) -> JsonRpcRequest:
    """Parse a request body into one JSON-RPC message.

    Batching was removed in protocol revision 2025-06-18, so a JSON array is
    an invalid request rather than a batch to iterate.
    """
    try:
        payload = json.loads(body or b"")
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProtocolError(PARSE_ERROR, "Invalid JSON in request body.") from exc
    if isinstance(payload, list):
        raise ProtocolError(
            INVALID_REQUEST,
            "JSON-RPC batching is not supported; send one message per request.",
        )
    if not isinstance(payload, dict):
        raise ProtocolError(INVALID_REQUEST, "Request body must be a JSON-RPC object.")
    try:
        return JsonRpcRequest.model_validate(payload)
    except ValidationError as exc:
        raise ProtocolError(
            INVALID_REQUEST, "Body is not a valid JSON-RPC 2.0 message."
        ) from exc


def success_payload(message_id: str | int, result: McpModel) -> dict[str, Any]:
    """Shape a JSON-RPC success response body."""
    return JsonRpcSuccessResponse(
        id=message_id, result=result.model_dump(by_alias=True, exclude_none=True)
    ).model_dump(by_alias=True)


def error_payload(message_id: str | int | None, error: ProtocolError) -> dict[str, Any]:
    """Shape a JSON-RPC error response body."""
    return JsonRpcErrorResponse(
        id=message_id,
        error=JsonRpcErrorBody(code=error.code, message=error.message, data=error.data),
    ).model_dump(by_alias=True, exclude_none=True)
