"""Bounded, durable ingestion queue.

The `documents` table is the queue: a `pending` row is queued work, and the
atomic claim in `run_document_ingestion` (`pending` → `processing`) is what
hands a document to exactly one worker. This module owns the worker pool that
drains it — a fixed-size `ThreadPoolExecutor` started from the app lifespan —
so any number of concurrent uploads never runs more than the configured
number of ingestions at once (issue #138: unbounded background tasks each
holding a DB connection across the embedding HTTP call exhausted the shared
pool, 500ing unrelated requests and stranding documents in `processing`).

Durability comes from the rows, not the executor's in-memory future queue:
`recover()` runs at startup, requeues documents stranded in `processing` by a
crash or restart, and re-enqueues everything `pending`. Re-running a document
from scratch is safe because re-ingestion overwrites the same
`{document_id}:{order}` chunk ids.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

logger = logging.getLogger(__name__)


class IngestionQueue:
    """Fixed-size worker pool draining `pending` documents.

    Owns the executor lifecycle (`start`/`stop`, called from the app
    lifespan) and the startup recovery sweep. When the queue has not been
    started — direct service calls in scripts and tests — `enqueue` falls
    back to running the ingestion inline so callers keep working, at the
    cost of the concurrency bound the running app always has.
    """

    def __init__(self) -> None:
        """Create an idle queue; no threads exist until `start`."""
        self._executor: ThreadPoolExecutor | None = None
        self._lock = threading.Lock()

    @property
    def started(self) -> bool:
        """Whether the worker pool is running."""
        return self._executor is not None

    def start(self, worker_count: int) -> None:
        """Start the worker pool with a fixed concurrency bound."""
        with self._lock:
            if self._executor is not None:
                return
            self._executor = ThreadPoolExecutor(
                max_workers=worker_count, thread_name_prefix="ingestion"
            )
        logger.info("Ingestion queue started with %d worker(s)", worker_count)

    def stop(self) -> None:
        """Shut the pool down without waiting out the backlog.

        Queued-but-unstarted documents stay `pending` and in-flight ones are
        left `processing`; the next startup's `recover()` re-runs both.
        """
        with self._lock:
            executor, self._executor = self._executor, None
        if executor is not None:
            executor.shutdown(wait=False, cancel_futures=True)

    def enqueue(self, document_id: UUID) -> None:
        """Queue one document for ingestion (or run inline when not started).

        Call only after the `pending` row is committed — a worker thread
        reads it through its own session, so an uncommitted row is invisible
        and the claim finds nothing.
        """
        from app.services.ingestion import run_document_ingestion

        with self._lock:
            executor = self._executor
        if executor is None:
            logger.warning(
                "Ingestion queue not started; ingesting document %s inline", document_id
            )
            run_document_ingestion(document_id)
            return
        executor.submit(run_document_ingestion, document_id)

    def recover(self) -> None:
        """Requeue documents stranded by a previous process, then drain.

        Runs once at startup, before any new uploads: documents left in
        `processing` (crash/restart mid-ingest, or the pool-exhaustion bug
        this queue replaces) go back to `pending`, and every `pending` id is
        enqueued.
        """
        from app.db.engine import session_scope
        from app.db.repositories import DocumentRepository

        with session_scope() as session:
            repository = DocumentRepository(session)
            requeued = repository.requeue_stranded_processing()
            pending = repository.pending_ids()
        if requeued:
            logger.info("Requeued %d document(s) stranded in processing", requeued)
        for document_id in pending:
            self.enqueue(document_id)


ingestion_queue = IngestionQueue()
"""Process-wide queue instance; the app lifespan owns its start/stop."""


def enqueue_document_ingestion(document_id: UUID) -> None:
    """Enqueue a committed `pending` document on the process-wide queue."""
    ingestion_queue.enqueue(document_id)
