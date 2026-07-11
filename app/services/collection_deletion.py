"""The collection-deletion cascade, expressed as named purge steps.

Deleting a collection tears down three stores that don't share a transaction:
the vector namespace (dispatched to whichever backend the collection's
ingestion pipeline indexes into), the file store (uploaded documents), and
the relational rows. Each is a named step so the sequence reads top-to-bottom
and a future change lands in exactly one place. Vector-purge failure
classification lives with each backend: a missing Pinecone namespace is
swallowed by `PineconeStore.delete_namespace` (nothing to delete), any other
Pinecone error surfaces as a 502 via `ExternalServiceError`; a pgvector
delete of zero rows is naturally idempotent.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository, DocumentRepository, FileNodeRepository
from app.schemas.enums import IndexBackend
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.pipeline_resolution import resolve_ingestion_pipeline
from app.telemetry import record
from app.telemetry.events import CollectionDeleted
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import get_vector_store


class CollectionDeletionService:
    """Delete a collection and every store that references it."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.collections = CollectionRepository(session)
        self.documents = DocumentRepository(session)
        self.storage = FileStorage()

    def delete(self, user: models.User, collection: models.Collection) -> None:
        """Purge vectors, files, and rows for a collection, then delete it."""
        resolved = resolve_ingestion_pipeline(self.session, user, collection)
        namespace = resolved.settings.namespace
        if not namespace:
            raise InvalidInputError("Ingestion pipeline namespace is not configured.")

        collection_id = collection.id
        # Only ingests that reached READY ever wrote vectors; a collection with
        # none holds nothing to purge, so don't demand backend prerequisites
        # (e.g. a Pinecone key) just to delete a collection whose ingests failed.
        has_indexed_documents = any(
            document.status == models.DocumentStatus.READY
            for document in self.documents.list_for_collection(collection.id)
        )
        if has_indexed_documents:
            self._purge_vectors(
                user,
                backend=resolved.settings.backend,
                index_name=resolved.settings.index_name,
                namespace=namespace,
            )
        self._purge_files(collection)
        self._purge_rows(collection)
        self.session.commit()
        record(CollectionDeleted(user_id=user.id, collection_id=collection_id))

    def _purge_vectors(
        self,
        user: models.User,
        *,
        backend: IndexBackend,
        index_name: str,
        namespace: str,
    ) -> None:
        """Delete the collection's vector namespace on its ingestion backend."""
        store = get_vector_store(backend, user=user, session=self.session)
        try:
            store.delete_namespace(index_name, namespace)
        except Exception as exc:  # pylint: disable=broad-exception-caught
            # The Pinecone store already swallowed the benign missing-namespace
            # case; anything that still raises from it is a real upstream fault.
            # pgvector errors are our own database's and surface as themselves.
            if backend is IndexBackend.PINECONE:
                raise ExternalServiceError(f"Failed to purge Pinecone namespace: {exc}") from exc
            raise

    def _purge_files(self, collection: models.Collection) -> None:
        """Remove every stored upload in the collection's file tree.

        Legacy documents' `source_path` and their backfilled file node's
        `storage_path` point at the same file, so deleting by node covers
        both eras (`delete_path` is a no-op on already-missing paths).
        """
        for node in FileNodeRepository(self.session).list_for_collection(collection.id):
            self.storage.delete_path(node.storage_path)

    def _purge_rows(self, collection: models.Collection) -> None:
        """Delete related rows, detach chat sessions, and delete the collection."""
        self.collections.purge_related_rows(collection.id)
        self.collections.delete(collection)
