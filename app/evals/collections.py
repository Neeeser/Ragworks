"""EvalCollectionService: the provisioned-eval-collection management surface.

Lists a user's eval collections with size/readiness stats, pages one
collection's materialized documents for the dataset browser, and purges a
collection to reclaim space. Split from `EvalService` (which owns datasets and
runs) so each facade stays one responsibility.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    CollectionRepository,
    CollectionStats,
    CollectionStatsRepository,
    DocumentRepository,
    EvalDatasetRepository,
)
from app.schemas.enums import CollectionPurpose, DocumentStatus
from app.schemas.evals import (
    EvalCollectionDocument,
    EvalCollectionDocumentsPage,
    EvalCollectionRead,
)
from app.services.collection_deletion import CollectionDeletionService
from app.services.errors import NotFoundError


class EvalCollectionService:
    """Facade for the eval-collections management and document-browser routes."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request session."""
        self.session = session
        self.collections = CollectionRepository(session)

    def list_eval_collections(self, user: models.User) -> list[EvalCollectionRead]:
        """Return the user's provisioned eval collections with size stats."""
        collections = self.collections.list_eval_for_user(user.id)
        ids = [collection.id for collection in collections]
        stats = CollectionStatsRepository(self.session).stats_for(user.id, ids)
        ready = DocumentRepository(self.session).ready_counts_by_collection(ids)
        return [
            self._to_eval_collection(
                collection, stats.get(collection.id), ready.get(collection.id, 0)
            )
            for collection in collections
        ]

    def list_collection_documents(
        self,
        user: models.User,
        collection_id: UUID,
        *,
        search: str | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> EvalCollectionDocumentsPage:
        """Page one eval collection's materialized documents for the browser.

        Each item carries the ingestion outcome (status, error, chunk count)
        and the corpus identity (external id, title); `document_id` addresses
        the document ingestion trace.
        """
        collection = self._require_eval_collection(user, collection_id)
        dataset_ref = collection.extra_metadata.get("eval_dataset_id")
        if not isinstance(dataset_ref, str):
            return EvalCollectionDocumentsPage(total=0, items=[])
        rows, total = EvalDatasetRepository(self.session).page_collection_documents(
            UUID(dataset_ref), collection.id, search=search, offset=offset, limit=limit
        )
        return EvalCollectionDocumentsPage(
            total=total,
            items=[
                EvalCollectionDocument(
                    document_id=document.id,
                    external_doc_id=external_id,
                    title=title,
                    status=DocumentStatus(document.status),
                    error_message=document.error_message,
                    num_chunks=document.num_chunks,
                )
                for document, external_id, title in rows
            ],
        )

    def delete_eval_collection(self, user: models.User, collection_id: UUID) -> None:
        """Purge one eval collection (vectors, files, rows) to reclaim space."""
        collection = self._require_eval_collection(user, collection_id)
        CollectionDeletionService(self.session).delete(user, collection)

    def _require_eval_collection(
        self, user: models.User, collection_id: UUID
    ) -> models.Collection:
        """Return a user-owned eval collection or raise NotFoundError."""
        collection = self.collections.get(collection_id, user.id)
        if collection is None or collection.system_purpose != CollectionPurpose.EVAL.value:
            raise NotFoundError("Eval collection not found.")
        return collection

    def _to_eval_collection(
        self, collection: models.Collection, stats: CollectionStats | None, ready: int
    ) -> EvalCollectionRead:
        """Shape one eval collection row for the management page."""
        dataset_ref = collection.extra_metadata.get("eval_dataset_id")
        ingest = CollectionPipelineBindingRepository(self.session).list_for_collection(
            collection.id, role=models.BindingRole.INGEST
        )
        return EvalCollectionRead(
            id=collection.id,
            name=collection.name,
            dataset_id=UUID(dataset_ref) if isinstance(dataset_ref, str) else None,
            ingestion_pipeline_id=ingest[0].pipeline_id if ingest else None,
            num_documents=stats.document_count if stats else 0,
            num_ready_documents=ready,
            num_chunks=stats.chunk_count if stats else 0,
            created_at=collection.created_at,
            updated_at=collection.updated_at,
        )
