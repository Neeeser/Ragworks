"""Observability subsystem: structured logging, correlation, and redaction.

The single owner of logging configuration, request correlation, redaction, and
the diagnostics export buffer for the whole backend. Features never configure
logging, generate request IDs, or implement redaction themselves — they call
``get_logger`` and emit named events (see ``app/observability/events.py`` and
the policy in ``.claude/rules/backend.md``).

Public API:

- ``configure_logging`` — install the pipeline (called once from the lifespan).
- ``RequestContextMiddleware`` — correlation ID + request logging.
- ``get_logger`` — the logger every module uses.
- ``request_context`` / ``bind_user_id`` / ``current_request_id`` — context.
- ``get_log_buffer`` — the export ring buffer.
"""

from __future__ import annotations

from app.observability.buffer import get_log_buffer
from app.observability.config import configure_logging
from app.observability.context import current_request_id, request_context
from app.observability.events import get_logger
from app.observability.middleware import RequestContextMiddleware

__all__ = [
    "RequestContextMiddleware",
    "configure_logging",
    "current_request_id",
    "get_log_buffer",
    "get_logger",
    "request_context",
]
