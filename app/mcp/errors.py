"""MCP fault types: JSON-RPC protocol errors and HTTP transport rejections.

The two are different layers and must not be conflated. A `ProtocolError` is a
well-formed HTTP request carrying a JSON-RPC message the server cannot honor —
it answers 200 with a JSON-RPC error body. A `TransportError` is an HTTP-level
rejection (bad Accept header, unsupported protocol version, missing key) that
never reaches JSON-RPC dispatch and answers with its own status code.
"""

from __future__ import annotations

from typing import Any

#: JSON-RPC 2.0 reserved codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class ProtocolError(Exception):
    """A JSON-RPC error to return in a 200 response body."""

    def __init__(self, code: int, message: str, data: dict[str, Any] | None = None) -> None:
        """Record the JSON-RPC code, message, and optional data payload."""
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


class TransportError(Exception):
    """An HTTP-level rejection of an MCP request."""

    def __init__(
        self, status_code: int, detail: str, headers: dict[str, str] | None = None
    ) -> None:
        """Record the HTTP status, client-facing detail, and any headers."""
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.headers = headers or {}
