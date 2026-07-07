"""Fire-and-forget telemetry recording.

``record`` owns this package's one invariant: recording never breaks the
feature being recorded. It opens its own short ``session_scope()`` (never a
request session — a failed telemetry write must never roll back or fail user
work) and swallows any failure with a logged warning. That swallow is a
deliberate, documented exception to the never-swallow rule, scoped to this
module and justified by the invariant. Telemetry is internal-only: rows go
to the local database, nothing is ever sent externally.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from app.db.engine import session_scope
from app.db.repositories import TelemetryRepository
from app.services.app_config import get_app_config
from app.telemetry.events import TelemetryEvent
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


def record(event: TelemetryEvent) -> None:
    """Persist one event, best-effort; honors the telemetry kill switch."""
    try:
        if not get_app_config().telemetry.enabled:
            return
        with session_scope() as session:
            TelemetryRepository(session).add(
                event_type=event.type,
                user_id=event.user_id,
                payload=event.model_dump(mode="json", exclude={"type", "user_id"}),
            )
    except Exception:
        logger.warning("Telemetry recording failed for %s", event.type, exc_info=True)


def purge_expired() -> int:
    """Delete events older than the configured retention; returns the count.

    Called from the app lifespan on startup. Best-effort like ``record`` —
    a failed purge logs and returns 0 rather than blocking boot.
    """
    try:
        retention_days = get_app_config().telemetry.retention_days
        cutoff = utc_now() - timedelta(days=retention_days)
        with session_scope() as session:
            purged = TelemetryRepository(session).purge_older_than(cutoff)
        if purged:
            logger.info("Purged %d telemetry events older than %d days", purged, retention_days)
        return purged
    except Exception:
        logger.warning("Telemetry purge failed", exc_info=True)
        return 0
