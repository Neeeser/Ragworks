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

from sqlmodel import Session

from app.db import models
from app.db.repositories import ChunkRepository, DocumentRepository, FileNodeRepository
from app.schemas.enums import FileNodeKind, IndexBackend
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.pipeline_resolution import resolve_ingestion_pipeline
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
        """Delete each document's vectors on every index the pipeline writes."""
        resolved = resolve_ingestion_pipeline(self.session, user, collection)
        namespace = resolved.settings.namespace
        if not namespace:
            raise InvalidInputError("Ingestion pipeline namespace is not configured.")
        for target in resolved.settings.index_targets:
            store = get_vector_store(target.backend, user=user, session=self.session)
            for document in documents:
                try:
                    store.delete_document_vectors(
                        target.index_name, namespace, str(document.id)
                    )
                except Exception as exc:  # pylint: disable=broad-exception-caught
                    if target.backend is IndexBackend.PINECONE:
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
        """Delete chunk rows, document rows, and the nodes themselves."""
        for document in documents:
            self.chunks.delete_for_document(document.id)
            self.session.delete(document)
        self.session.flush()
        for node in doomed:  # children precede parents, so FKs stay satisfied
            self.nodes.delete(node)
