"""structlog configuration for the application and Uvicorn loggers.

``configure_logging`` installs one processing pipeline for every log record —
structlog-native calls and foreign stdlib records (Uvicorn, SQLAlchemy, the
~30 modules still using ``logging.getLogger``) alike — so all output is
uniform JSON (or a pretty console renderer in DEBUG dev mode) with the same
UTC timestamps, redaction, and export ring-buffer tee.

Existing ``logging.getLogger`` calls keep working and emit through this
pipeline immediately, with no per-module change required; migration to named
structured events is incremental from there.

Called once from the app lifespan (never at import time — no import-time side
effects). Output is stdout only: no files, no rotation, no shipping.
"""

from __future__ import annotations

import logging
import sys

import structlog

from app.observability.buffer import buffer_processor
from app.observability.redaction import redact_processor

# Processors shared by native and foreign records, in order. Redaction and the
# buffer tee run last (on the fully-built dict) but before rendering, so the
# buffer holds redacted dicts and stdout renders the same redacted content.
_TIMESTAMPER = structlog.processors.TimeStamper(fmt="iso", utc=True)

_PRE_CHAIN: list[structlog.types.Processor] = [
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    _TIMESTAMPER,
    structlog.stdlib.PositionalArgumentsFormatter(),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
    redact_processor,
    buffer_processor,
]


def _resolve_level(level: str | None) -> int:
    """Resolve a level name to a logging constant, defaulting to INFO."""
    name = (level or "").strip().upper()
    if not name:
        return logging.INFO
    return getattr(logging, name, logging.INFO)


def configure_logging(level: str | None = None, *, debug: bool = False) -> None:
    """Configure structlog + stdlib logging to emit structured records.

    ``debug`` selects the pretty console renderer for local development; JSON
    is the default and the only production format. Redaction runs in both
    modes — DEBUG never relaxes it.
    """
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            *_PRE_CHAIN,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    renderer: structlog.types.Processor = (
        structlog.dev.ConsoleRenderer() if debug else structlog.processors.JSONRenderer()
    )
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=list(_PRE_CHAIN),
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(_resolve_level(level))

    # Uvicorn: route error/startup logs through our handler, but silence the
    # per-request access log — the request middleware emits a richer, redacted
    # `http.request.completed` event, and the raw access line would duplicate
    # it while logging the raw path.
    for name in ("uvicorn", "uvicorn.error"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True
    access_logger = logging.getLogger("uvicorn.access")
    access_logger.handlers = []
    access_logger.propagate = False

    # httpx/httpcore log every outbound provider request at INFO with the full
    # URL. That is noise next to our own event stream and risks emitting a raw
    # request URL, so raise them to WARNING (errors still surface).
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
