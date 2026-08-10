"""Shared rendering of connection-validation failure messages."""

from __future__ import annotations

import json


def validation_failure_message(provider_label: str, status_code: int, body: str) -> str:
    """Describe a non-auth upstream validation failure with its own evidence.

    A bare "<provider> validation failed." leaves the user diagnosing blind —
    the upstream status and the provider's own error text are what say whether
    the endpoint is down, misconfigured, or rejecting the request shape.
    """
    detail = _error_detail(body)
    prefix = f"{provider_label} validation failed (HTTP {status_code})"
    return f"{prefix}: {detail}" if detail else f"{prefix}."


def _error_detail(body: str) -> str | None:
    """Pull the human-readable error text out of a provider error body."""
    try:
        payload = json.loads(body)
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error = payload.get("error")
        candidates = (
            error.get("message") if isinstance(error, dict) else error,
            payload.get("detail"),
            payload.get("message"),
        )
        for candidate in candidates:
            if isinstance(candidate, str) and candidate.strip():
                return _truncate(candidate.strip())
        return None
    text = body.strip()
    return _truncate(text) if text and len(text) <= 500 else None


def _truncate(text: str, limit: int = 200) -> str:
    """Cap the upstream text so a page-long HTML error stays one line."""
    return text if len(text) <= limit else text[: limit - 1] + "…"
