"""Queue-worker entry point for document ingestion.

A worker runs outside any request and has no caller left to raise to, so this
module owns the lifecycle a request-scoped service cannot: its own session, the
atomic `pending` -> `processing` claim that dedupes a double enqueue, and the
last-resort FAILED write. `IngestionService` (`app/services/ingestion.py`) owns
running the pipeline itself and knows nothing about queues.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from app.db import models
from app.db.engine import session_scope
from app.db.repositories import DocumentRepository
from app.observability import events as log_events
from app.observability import get_logger, request_context
from app.services.ingestion import IngestionService
from app.visualization.insights.tasks import schedule_insight_refresh

logger = get_logger(__name__)


def run_document_ingestion(document_id: UUID, request_id: str | None = None) -> None:
    """Worker entry point: claim and ingest one pending document, never raise.

    Opens its own `session_scope` — queue workers run outside any request
    (and its session). The atomic `pending` → `processing` claim is the
    dedupe gate: a duplicate enqueue of the same document loses the claim
    and returns without touching it. Failures are already recorded on the
    document row by `ingest_document`; this wrapper only keeps the worker
    quiet.

    `request_id` carries the enqueuing request's correlation ID into the
    worker's logs; a fresh one is minted when the work has no originating
    request (startup recovery).
    """
    with request_context(request_id=request_id or str(uuid4())), session_scope() as session:
        if not DocumentRepository(session).claim_for_ingestion(document_id):
            return
        session.commit()  # make the claim visible to pollers and other workers
        document = session.get(models.Document, document_id)
        if document is None:
            return
        user = session.get(models.User, document.user_id)
        collection = session.get(models.Collection, document.collection_id)
        if user is None or collection is None:
            return
        try:
            IngestionService(session).ingest_document(
                user=user, collection=collection, document=document
            )
        except Exception as exc:
            # Deliberately broad: the outcome is normally already persisted
            # as a FAILED document with an error message; a queue worker has
            # no caller left to re-raise to.
            logger.error(
                log_events.BACKGROUND_TASK_FAILED,
                task="ingestion",
                document_id=str(document_id),
                error_type=exc.__class__.__name__,
                exc_info=True,
            )
            _ensure_failure_recorded(document_id, exc)
        else:
            # The freshness hook: every successful ingestion places its new
            # chunks into the collection's insight map in the background (or
            # queues the first build). Failures there record themselves on
            # the snapshot row and never affect the ingestion outcome.
            schedule_insight_refresh(collection.id, user.id)


def _ensure_failure_recorded(document_id: UUID, exc: Exception) -> None:
    """Last-resort FAILED write on a fresh session; never leaves `processing`.

    `ingest_document` records failures on its own session — but when that
    session's transaction is already aborted (e.g. an `IntegrityError` from
    concurrent index DDL), its failure-recording commit raises too and the
    document would stay `processing` forever with no error. A fresh session
    is immune to the poisoned one, so the honest FAILED outcome always lands.
    """
    try:
        with session_scope() as session:
            document = session.get(models.Document, document_id)
            if document is None or document.status != models.DocumentStatus.PROCESSING:
                return
            document.status = models.DocumentStatus.FAILED
            document.error_message = str(exc) or exc.__class__.__name__
            session.add(document)
    except Exception:
        # Swallowing here is deliberate: this is the recorder of last resort,
        # and raising from it would only kill the worker thread.
        logger.error(
            log_events.BACKGROUND_TASK_FAILED,
            task="ingestion_failure_recording",
            document_id=str(document_id),
            exc_info=True,
        )
