"""The file-deletion cascade, expressed as named purge steps.

Deleting a file (or a folder subtree) tears down the same three stores as
collection deletion, scoped to the affected documents: the documents' vectors
on whichever backend the collection's ingestion pipeline indexes into, the
stored bytes, and the relational rows (chunks, document, file nodes). Vector
purge is per-document (`delete_document_vectors`), so sibling files' vectors
survive. Error classification mirrors `CollectionDeletionService`: Pinecone
faults surface as 502s, pgvector errors are our own database's.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.db import models
from app.db.repositories import ChunkRepository, DocumentRepository, FileNodeRepository
from app.schemas.enums import FileNodeKind, IndexBackend
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.pipeline_resolution import resolve_purge_targets
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import get_vector_store


class FileDeletionService:
    """Delete a file-tree node and every store that references it."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.nodes = FileNodeRepository(session)
        self.documents = DocumentRepository(session)
        self.chunks = ChunkRepository(session)
        self.storage = FileStorage()

    def delete(
        self,
        user: models.User,
        collection: models.Collection,
        node: models.FileNode,
    ) -> None:
        """Purge vectors, bytes, and rows for a node (recursively for folders)."""
        doomed = self._collect_subtree(node)
        indexed = [
            (file_node, document)
            for file_node, document in (
                (file_node, self.documents.get_for_file(file_node.id))
                for file_node in doomed
                if file_node.kind == FileNodeKind.FILE
            )
            if document is not None
        ]
        # Only READY documents ever wrote vectors; skip backend prerequisites
        # (e.g. a Pinecone key) when there is nothing to purge.
        if any(doc.status == models.DocumentStatus.READY for _, doc in indexed):
            self._purge_vectors(
                user,
                collection,
                [doc for _, doc in indexed if doc.status == models.DocumentStatus.READY],
            )
        self._purge_files(doomed)
        self._purge_rows(doomed, [doc for _, doc in indexed])
        self.session.commit()

    def _collect_subtree(self, node: models.FileNode) -> list[models.FileNode]:
        """Return the node and every descendant, children before parents."""
        all_nodes = self.nodes.list_for_collection(node.collection_id)
        children_of: dict[object, list[models.FileNode]] = {}
        for candidate in all_nodes:
            children_of.setdefault(candidate.parent_id, []).append(candidate)
        ordered: list[models.FileNode] = []

        def visit(current: models.FileNode) -> None:
            for child in children_of.get(current.id, []):
                visit(child)
            ordered.append(current)

        visit(node)
        return ordered

    def _purge_vectors(
        self,
        user: models.User,
        collection: models.Collection,
        documents: list[models.Document],
    ) -> None:
        """Delete each document's vectors on every index any binding writes.

        Iterates the union of targets across the collection's bindings — the
        same purge contract as collection deletion.
        """
        for item in resolve_purge_targets(self.session, user, collection):
            if item.namespace is None:
                raise InvalidInputError("Ingestion pipeline namespace is not configured.")
            store = get_vector_store(item.target.backend, user=user, session=self.session)
            for document in documents:
                try:
                    store.delete_document_vectors(
                        item.target.index_name, item.namespace, str(document.id)
                    )
                except Exception as exc:
                    if item.target.backend is IndexBackend.PINECONE:
                        raise ExternalServiceError(
                            f"Failed to purge Pinecone vectors: {exc}"
                        ) from exc
                    raise

    def _purge_files(self, doomed: list[models.FileNode]) -> None:
        """Remove stored bytes for every file node in the subtree."""
        for node in doomed:
            if node.kind == FileNodeKind.FILE:
                self.storage.delete_path(node.storage_path)

    def _purge_rows(
        self,
        doomed: list[models.FileNode],
        documents: list[models.Document],
    ) -> None:
        """Delete chunk rows, event/point rows, documents, and the nodes."""
        for document in documents:
            self._purge_document_rows(document)
        for node in doomed:  # children precede parents, so FKs stay satisfied
            self.nodes.delete(node)

    def _purge_document_rows(self, document: models.Document) -> None:
        """Delete one document's chunks, events, and row — retried once.

        Ingestion for a file deleted while its ingestion is still in flight
        commits its chunk rows from the worker's own session, and that can land
        *between* this chunk purge and the document delete — the document's
        foreign key then rejects the delete and the whole request 500s. (An
        agent uploading over MCP and deleting moments later hits this window
        routinely; a person clicking through the Files page can too.) Retrying
        inside a savepoint re-purges whatever arrived, so deletion wins instead
        of surfacing an IntegrityError. One retry is enough: ingestion writes a
        document's chunks once.
        """
        for attempt in (1, 2):
            savepoint = self.session.begin_nested()
            try:
                self.chunks.delete_for_document(document.id)
                self.documents.delete_ingestion_events(document.id)
                self.session.delete(document)
                self.session.flush()
            except IntegrityError:
                savepoint.rollback()
                if attempt == 2:
                    raise
            else:
                savepoint.commit()
                return
