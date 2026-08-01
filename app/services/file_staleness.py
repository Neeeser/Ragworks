"""Ingestion staleness: which ready documents predate the current pipeline.

A document is stale when it was ingested by an older version of the
collection's bound ingestion pipeline — or by a different pipeline than the
one currently bound. Documents with no recorded run (rows from before run
lineage existed) are unknown, not stale: flagging them would alarm on state
the user cannot inspect.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    DocumentRepository,
    PipelineRunRepository,
)


class IngestionStaleness:
    """Computes per-document staleness against the bound ingestion pipeline."""

    def __init__(self, session: Session, collection_id: UUID) -> None:
        """Resolve the collection's ingest binding read-only; unbound = never stale."""
        self.session = session
        self.pipeline: models.Pipeline | None = None
        bindings = CollectionPipelineBindingRepository(session).list_for_collection(
            collection_id, role=models.BindingRole.INGEST
        )
        if bindings:
            self.pipeline = session.get(models.Pipeline, bindings[0].pipeline_id)

    def stale_document_ids(self, documents: list[models.Document]) -> set[UUID]:
        """Return ids of ready documents whose ingestion run predates the pipeline."""
        pipeline = self.pipeline
        if pipeline is None:
            return set()
        run_ids = [
            document.ingestion_run_id
            for document in documents
            if document.status == models.DocumentStatus.READY
            and document.ingestion_run_id is not None
        ]
        runs = PipelineRunRepository(self.session).get_many(run_ids)
        stale: set[UUID] = set()
        for document in documents:
            if document.status != models.DocumentStatus.READY:
                continue
            run = runs.get(document.ingestion_run_id) if document.ingestion_run_id else None
            if run is None or run.pipeline_version is None:
                continue
            if run.pipeline_id != pipeline.id or run.pipeline_version < pipeline.current_version:
                stale.add(document.id)
        return stale


def stale_ingestion_ids(
    session: Session, collection_id: UUID, documents: list[models.Document]
) -> set[UUID]:
    """Convenience wrapper: stale ids among `documents` for one collection."""
    return IngestionStaleness(session, collection_id).stale_document_ids(documents)


def mark_stale_documents_pending(
    session: Session, collection: models.Collection
) -> list[UUID]:
    """Reset every stale ready document to `pending` and return their ids.

    The caller commits and enqueues — the queue contract requires the pending
    rows to be committed before a worker can claim them.
    """
    documents = DocumentRepository(session).list_for_collection(collection.id)
    stale_ids = IngestionStaleness(session, collection.id).stale_document_ids(documents)
    for document in documents:
        if document.id in stale_ids:
            document.status = models.DocumentStatus.PENDING
            document.error_message = None
            session.add(document)
    return [document.id for document in documents if document.id in stale_ids]
