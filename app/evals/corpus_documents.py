"""One corpus document inside an eval collection: naming, ingestion, repair.

A benchmark corpus document is materialized as an ordinary file whose name
encodes its external id, ingested through the pipeline under test, and — when
that attempt left it out of the index — re-attempted. Provisioning
(`app/evals/provisioning.py`) drives the first two; provisioning and the
collection's retry endpoint share the third, so both agree on what "did not
reach the index" means.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.engine import session_scope
from app.db.repositories import DocumentRepository
from app.services.errors import InvalidInputError
from app.services.ingestion import IngestionService

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[], None]


def file_name_for(external_doc_id: str) -> str:
    """Build the file name that encodes a corpus doc's external id."""
    safe = external_doc_id.replace("/", "_")
    if not safe:
        raise InvalidInputError("Corpus document has an empty external id.")
    return f"{safe}.txt"


def external_id_from_name(name: str) -> str:
    """Recover the external doc id from the file/document name."""
    return name.removesuffix(".txt")


def reached_the_index(document: models.Document) -> bool:
    """Whether one materialized corpus document is queryable.

    Indexed chunks are the test rather than the status alone: a document that
    produced none is invisible to retrieval however its row is labelled.
    """
    return document.status == models.DocumentStatus.READY and document.num_chunks > 0


def unindexed_documents(
    session: Session, collection_id: UUID, *, names: set[str] | None = None
) -> list[models.Document]:
    """Corpus documents that were materialized but never indexed.

    A failed ingestion leaves its document row behind, so provisioning's
    not-yet-materialized check reads it as present and skips it. Without
    re-attempting these, one bad document is permanent for the eval
    collection's cache key and no later run can repair it.

    `processing` is excluded — a run may be ingesting the document right now,
    and re-entering it would put two pipelines on one row. `names` restricts
    the sweep to one run's sampled corpus; omit it to cover the collection.
    """
    return [
        document
        for document in DocumentRepository(session).list_for_collection(collection_id)
        if (names is None or document.name in names)
        and document.status != models.DocumentStatus.PROCESSING
        and not reached_the_index(document)
    ]


def mark_pending(session: Session, documents: list[models.Document]) -> list[UUID]:
    """Reset documents to `pending` for the ingestion queue; the caller commits.

    The queue's claim only moves a `pending` row, so a `failed` document
    handed straight to a worker is dropped without a trace.
    """
    for document in documents:
        document.status = models.DocumentStatus.PENDING
        document.error_message = None
        session.add(document)
    return [document.id for document in documents]


def ingest_all(
    user_id: UUID,
    collection_id: UUID,
    document_ids: list[UUID],
    on_document_done: ProgressCallback | None,
    concurrency: int,
) -> None:
    """Ingest registered documents: serial until one succeeds, then pooled.

    The first successful ingest creates the pipeline's indexes, so pooled
    workers never race index creation; the remainder then fans out, each
    worker in its own session.
    """
    remaining = list(document_ids)
    while remaining:
        succeeded = ingest_one(user_id, collection_id, remaining.pop(0))
        if on_document_done is not None:
            on_document_done()
        if succeeded:
            break
    if not remaining:
        return
    with ThreadPoolExecutor(max_workers=max(concurrency, 1)) as pool:
        futures = [
            pool.submit(ingest_one, user_id, collection_id, document_id)
            for document_id in remaining
        ]
        for future in as_completed(futures):
            future.result()
            if on_document_done is not None:
                on_document_done()


def ingest_one(user_id: UUID, collection_id: UUID, document_id: UUID) -> bool:
    """Ingest one registered corpus document in its own session.

    Worker-safe: loads its rows fresh and never touches the provisioner's
    session. A failure is deliberately non-fatal, mirroring background
    ingestion — the FAILED document row is the recorded outcome (stage-0
    funnel loss), and one unparseable/failing doc must not kill the run.
    """
    with session_scope() as session:
        user = session.get(models.User, user_id)
        collection = session.get(models.Collection, collection_id)
        document = session.get(models.Document, document_id)
        if user is None or collection is None or document is None:
            return False
        try:
            IngestionService(session).ingest_document(
                user=user, collection=collection, document=document
            )
        except Exception:
            # Deliberately broad: see docstring.
            logger.exception("Eval corpus document %s failed to ingest", document.name)
            return False
        return True
