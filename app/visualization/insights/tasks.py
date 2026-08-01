"""Background scheduling for insight computation.

One lazily started single-worker executor serializes all insight compute in
the process: projections are CPU-bound, and two concurrent fits would fight
over the same cores for no wall-clock win. Work is idempotent and derived
entirely from database state, so a task lost to shutdown simply runs again
on the next trigger (ingestion completion, page refresh action).
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID, uuid4

from app.db.engine import session_scope
from app.observability import current_request_id, get_logger, request_context
from app.observability import events as log_events

logger = get_logger(__name__)

_lock = threading.Lock()
_executor: ThreadPoolExecutor | None = None


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="insights")
        return _executor


def schedule_insight_refresh(collection_id: UUID, user_id: UUID) -> bool:
    """Queue a refresh for a collection; returns whether one was started.

    The `computing` marker row is created (and committed) here, on the
    caller's side of the queue, so the page shows progress immediately and
    a second trigger while one is pending is a no-op.
    """
    from app.services.app_config import get_app_config
    from app.visualization.insights.service import InsightService

    # A disabled feature must not keep burning CPU in the background just
    # because ingestion still runs.
    if not get_app_config().features.collection_insights:
        return False
    request_id = current_request_id() or str(uuid4())
    with session_scope() as session:
        service = InsightService(session)
        if not service.can_compute(collection_id):
            return False
        snapshot = service.begin_refresh(collection_id, user_id)
        # Read inside the scope: leaving it expires the instance, and a
        # detached expired row raises on its first attribute access.
        snapshot_id = snapshot.id if snapshot is not None else None
    if snapshot_id is None:
        return False
    _get_executor().submit(_run_refresh, snapshot_id, request_id)
    return True


def _run_refresh(snapshot_id: UUID, request_id: str) -> None:
    """Worker entry point: fill one marker snapshot, never raise."""
    from app.db import models
    from app.visualization.insights.service import InsightService

    with request_context(request_id=request_id):
        try:
            with session_scope() as session:
                snapshot = session.get(models.InsightSnapshotRecord, snapshot_id)
                if snapshot is None:
                    return
                InsightService(session).run_refresh(snapshot)
        except Exception as exc:
            # The failed marker row is the outcome the page reports; a
            # background worker has no caller to re-raise to.
            logger.error(
                log_events.BACKGROUND_TASK_FAILED,
                task="insights",
                snapshot_id=str(snapshot_id),
                error_type=exc.__class__.__name__,
                exc_info=True,
            )
            _record_failure(snapshot_id, exc)


def _record_failure(snapshot_id: UUID, exc: Exception) -> None:
    """Best-effort FAILED write on a fresh session (the first may be poisoned)."""
    from app.visualization.insights.service import InsightService

    try:
        with session_scope() as session:
            InsightService(session).mark_failed(snapshot_id, exc)
    except Exception:
        logger.error(
            log_events.BACKGROUND_TASK_FAILED,
            task="insights_failure_recording",
            snapshot_id=str(snapshot_id),
            exc_info=True,
        )
