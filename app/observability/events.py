"""Event vocabulary for structured logging.

The single entry point services and clients use is ``get_logger``. Event names
passed to it are stable, dotted, past-tense facts — ``domain.action[.outcome]``
— and identifiers travel as structured keyword fields, never interpolated into
the message string. The constants below are the canonical names for the
high-value flows instrumented across the app; new call sites either reuse one
of these or follow the same ``domain.action.outcome`` shape.
"""

from __future__ import annotations

from typing import cast

import structlog

# Lifecycle
APP_STARTUP_COMPLETED = "app.startup.completed"
APP_SHUTDOWN_COMPLETED = "app.shutdown.completed"
DB_BOOTSTRAP_COMPLETED = "db.bootstrap.completed"
DB_MIGRATION_APPLIED = "db.migration.applied"
DB_MIGRATION_FAILED = "db.migration.failed"

# HTTP request boundary
HTTP_REQUEST_COMPLETED = "http.request.completed"
HTTP_REQUEST_FAILED = "http.request.failed"

# Authentication
AUTH_LOGIN_SUCCEEDED = "auth.login.succeeded"
AUTH_LOGIN_FAILED = "auth.login.failed"

# Admin configuration
ADMIN_CONFIG_UPDATED = "admin.config.updated"

# Ingestion and pipelines
INGESTION_STARTED = "ingestion.started"
INGESTION_COMPLETED = "ingestion.completed"
INGESTION_FAILED = "ingestion.failed"
PIPELINE_RUN_STARTED = "pipeline.run.started"
PIPELINE_RUN_COMPLETED = "pipeline.run.completed"
PIPELINE_RUN_FAILED = "pipeline.run.failed"

# MCP endpoint
MCP_AUTH_REJECTED = "mcp.auth.rejected"
MCP_TOOL_CALLED = "mcp.tool.called"
MCP_TOOL_FAILED = "mcp.tool.failed"

# External dependencies
PROVIDER_CALL_FAILED = "provider.call.failed"
VECTORSTORE_CALL_FAILED = "vectorstore.call.failed"

# Background work
BACKGROUND_TASK_FAILED = "background.task.failed"


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger for a module.

    Call as ``logger = get_logger(__name__)`` and emit events by name:
    ``logger.info(events.INGESTION_COMPLETED, document_id=str(doc.id),
    duration_ms=elapsed)``.
    """
    # structlog types get_logger() as returning Any (it hands back a lazy proxy
    # that binds to a BoundLogger on first use); the cast names the real shape.
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(name))
