"""The collection file tree: folders, uploads, moves, and path resolution.

`FileNode` rows are identity and hierarchy; whether a file was ingested is
its `Document` row (`documents.file_id`). Uploads always persist the file —
ingestion eligibility only decides whether a pending document row is created
for the background ingestion worker to pick up.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import BinaryIO
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import DocumentRepository, FileNodeRepository
from app.schemas.enums import FileNodeKind
from app.schemas.files import (
    FileListingResponse,
    FileNodeRead,
    FileNodeUpdate,
    FileTreeResponse,
)
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError, NotFoundError
from app.utils.file_storage import FileStorage

_FORBIDDEN_NAMES = {".", ".."}


def is_ingestible(content_type: str | None) -> bool:
    """Return True when the collection pipeline should auto-ingest this type."""
    if not content_type:
        return False
    return content_type in get_app_config().uploads.allowed_content_types


def validate_node_name(name: str) -> str:
    """Return a trimmed, safe node name or raise `InvalidInputError`."""
    trimmed = name.strip()
    if not trimmed or trimmed in _FORBIDDEN_NAMES or "/" in trimmed or "\x00" in trimmed:
        raise InvalidInputError("File and folder names must be non-empty and cannot contain '/'.")
    if len(trimmed) > 255:
        raise InvalidInputError("File and folder names must be at most 255 characters.")
    return trimmed


@dataclass
class UploadSpec:
    """Identity of one incoming upload, as the route received it."""

    filename: str | None = None
    content_type: str | None = None
    parent_id: UUID | None = None
    relative_path: str | None = None


@dataclass
class UploadResult:
    """What one registered upload produced."""

    file: models.FileNode
    document: models.Document | None = None
    created_folders: list[models.FileNode] = field(default_factory=list)


class FileSystemService:
    """Tree reads and non-destructive tree mutations for one user's files."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.nodes = FileNodeRepository(session)
        self.documents = DocumentRepository(session)
        self.storage = FileStorage()

    # -- reads ---------------------------------------------------------------

    def tree(self, collection: models.Collection) -> FileTreeResponse:
        """Return the whole tree as a flat, path-annotated node list."""
        nodes = self.nodes.list_for_collection(collection.id)
        paths = self._paths_for(nodes)
        ingestion = self._ingestion_by_file(collection.id)
        return FileTreeResponse(
            collection_id=collection.id,
            nodes=[
                FileNodeRead.from_model(
                    node, path=paths[node.id], ingestion=ingestion.get(node.id)
                )
                for node in nodes
            ],
        )

    def listing(
        self, collection: models.Collection, parent_id: UUID | None
    ) -> FileListingResponse:
        """Return one folder's children plus ancestry — the `ls` view."""
        parent = None
        if parent_id is not None:
            parent = self.require_folder(collection.id, parent_id)
        entries = self.nodes.list_children(collection.id, parent_id)
        all_nodes = self.nodes.list_for_collection(collection.id)
        paths = self._paths_for(all_nodes)
        ingestion = self._ingestion_by_file(collection.id)
        breadcrumb: list[FileNodeRead] = []
        cursor = parent
        by_id = {node.id: node for node in all_nodes}
        while cursor is not None:
            breadcrumb.append(FileNodeRead.from_model(cursor, path=paths[cursor.id]))
            cursor = by_id.get(cursor.parent_id) if cursor.parent_id else None
        breadcrumb.reverse()
        return FileListingResponse(
            parent=(
                FileNodeRead.from_model(parent, path=paths[parent.id]) if parent else None
            ),
            breadcrumb=breadcrumb,
            entries=[
                FileNodeRead.from_model(
                    node, path=paths[node.id], ingestion=ingestion.get(node.id)
                )
                for node in entries
            ],
        )

    def read_node(self, node: models.FileNode) -> FileNodeRead:
        """Return one node annotated with its path and ingestion summary."""
        nodes = self.nodes.list_for_collection(node.collection_id)
        paths = self._paths_for(nodes)
        document = self.documents.get_for_file(node.id)
        return FileNodeRead.from_model(node, path=paths[node.id], ingestion=document)

    def resolve_path(self, collection: models.Collection, path: str) -> models.FileNode:
        """Resolve a slash-separated path to its node or raise `NotFoundError`.

        The groundwork for model-facing navigation tools: `ls`/`cd` resolve
        human-readable paths through this single helper.
        """
        segments = [segment for segment in path.split("/") if segment]
        if not segments:
            raise NotFoundError("Path resolves to the collection root, not a node.")
        parent_id: UUID | None = None
        node: models.FileNode | None = None
        for segment in segments:
            node = self.nodes.find_child_by_name(collection.id, parent_id, segment)
            if node is None:
                raise NotFoundError(f"No file or folder at path '{path}'.")
            parent_id = node.id
        return node  # type: ignore[return-value]  # loop ran ≥ once, so node is set

    # -- mutations -----------------------------------------------------------

    def create_folder(
        self,
        user: models.User,
        collection: models.Collection,
        *,
        name: str,
        parent_id: UUID | None,
    ) -> models.FileNode:
        """Create a folder, rejecting sibling-name collisions."""
        clean = validate_node_name(name)
        if parent_id is not None:
            self.require_folder(collection.id, parent_id)
        if self.nodes.find_child_by_name(collection.id, parent_id, clean):
            raise InvalidInputError(f"'{clean}' already exists in this folder.")
        node = models.FileNode(
            collection_id=collection.id,
            user_id=user.id,
            parent_id=parent_id,
            kind=FileNodeKind.FOLDER,
            name=clean,
        )
        self.nodes.add(node)
        self.session.commit()
        self.session.refresh(node)
        return node

    def register_upload(
        self,
        user: models.User,
        collection: models.Collection,
        spec: UploadSpec,
        stream: BinaryIO,
    ) -> UploadResult:
        """Persist an uploaded file and, when eligible, a pending document row.

        `spec.relative_path` (from folder drag-and-drop) may carry
        intermediate folders, which are created (or reused) under
        `spec.parent_id`. The stored file is keyed by node id, so later
        renames/moves never touch disk.
        """
        segments = [s for s in (spec.relative_path or "").split("/") if s]
        name = validate_node_name(
            segments[-1] if segments else (spec.filename or "uploaded-file")
        )
        parent_id, created_folders = self._create_missing_folders(
            user, collection, spec.parent_id, segments[:-1]
        )

        node = models.FileNode(
            collection_id=collection.id,
            user_id=user.id,
            parent_id=parent_id,
            kind=FileNodeKind.FILE,
            name=self.dedupe_name(collection.id, parent_id, name),
            content_type=spec.content_type or "application/octet-stream",
        )
        self.nodes.add(node)
        stored = self.storage.save_stream(
            stream, f"collections/{collection.id}/files/{node.id}"
        )
        node.storage_path = str(stored)
        node.size_bytes = stored.stat().st_size
        self.session.add(node)

        document = None
        if is_ingestible(node.content_type):
            document = self.ensure_pending_document(user, collection, node)
        self.session.commit()
        self.session.refresh(node)
        return UploadResult(file=node, document=document, created_folders=created_folders)

    def ensure_pending_document(
        self,
        user: models.User,
        collection: models.Collection,
        node: models.FileNode,
    ) -> models.Document:
        """Create or reset the file's ingestion record to `pending`.

        The document row mirrors the file node's identity columns because the
        pipeline's ingestion-input node reads its source off the document.
        """
        document = self.documents.get_for_file(node.id)
        if document is None:
            document = models.Document(
                collection_id=collection.id,
                user_id=user.id,
                file_id=node.id,
                name=node.name,
                content_type=node.content_type or "application/octet-stream",
                embedding_model="",
            )
        document.name = node.name
        document.content_type = node.content_type or "application/octet-stream"
        document.source_path = node.storage_path
        document.status = models.DocumentStatus.PENDING
        document.error_message = None
        self.session.add(document)
        self.session.flush()
        return document

    def update_node(self, node: models.FileNode, payload: FileNodeUpdate) -> models.FileNode:
        """Rename and/or move a node, keeping the tree acyclic."""
        target_parent_id = node.parent_id
        if "parent_id" in payload.model_fields_set:
            target_parent_id = payload.parent_id
            if target_parent_id is not None:
                parent = self.require_folder(node.collection_id, target_parent_id)
                self.reject_cycle(node, parent, action="move")
        name = node.name
        if payload.name is not None:
            name = validate_node_name(payload.name)
        if target_parent_id != node.parent_id or name != node.name:
            existing = self.nodes.find_child_by_name(node.collection_id, target_parent_id, name)
            if existing is not None and existing.id != node.id:
                raise InvalidInputError(f"'{name}' already exists in the destination folder.")
        node.parent_id = target_parent_id
        node.name = name
        self.session.add(node)
        # Keep the ingestion record's mirrored name in sync for trace views.
        document = self.documents.get_for_file(node.id)
        if document is not None and document.name != name:
            document.name = name
            self.session.add(document)
        self.session.commit()
        self.session.refresh(node)
        return node

    # -- helpers -------------------------------------------------------------

    def _create_missing_folders(
        self,
        user: models.User,
        collection: models.Collection,
        parent_id: UUID | None,
        folder_names: list[str],
    ) -> tuple[UUID | None, list[models.FileNode]]:
        """Walk/create a folder chain; return the final parent and new nodes."""
        created_folders: list[models.FileNode] = []
        for folder_name in folder_names:
            parent_id, created = self._ensure_folder(
                user, collection, parent_id, validate_node_name(folder_name)
            )
            if created is not None:
                created_folders.append(created)
        return parent_id, created_folders

    def _ensure_folder(
        self,
        user: models.User,
        collection: models.Collection,
        parent_id: UUID | None,
        name: str,
    ) -> tuple[UUID, models.FileNode | None]:
        """Return (folder id, created node) — reusing an existing folder."""
        existing = self.nodes.find_child_by_name(collection.id, parent_id, name)
        if existing is not None:
            if existing.kind != FileNodeKind.FOLDER:
                raise InvalidInputError(
                    f"'{name}' already exists as a file; cannot create a folder over it."
                )
            return existing.id, None
        node = models.FileNode(
            collection_id=collection.id,
            user_id=user.id,
            parent_id=parent_id,
            kind=FileNodeKind.FOLDER,
            name=name,
        )
        self.nodes.add(node)
        return node.id, node

    def dedupe_name(self, collection_id: UUID, parent_id: UUID | None, name: str) -> str:
        """Suffix ` (n)` before the extension until the name is free."""
        if self.nodes.find_child_by_name(collection_id, parent_id, name) is None:
            return name
        stem, dot, suffix = name.rpartition(".")
        base, extension = (stem, f".{suffix}") if dot else (name, "")
        counter = 1
        while True:
            candidate = f"{base} ({counter}){extension}"
            if self.nodes.find_child_by_name(collection_id, parent_id, candidate) is None:
                return candidate
            counter += 1

    def require_folder(self, collection_id: UUID, node_id: UUID) -> models.FileNode:
        """Return a folder in this collection or raise a domain error."""
        node = self.nodes.get(node_id)
        if node is None or node.collection_id != collection_id:
            raise NotFoundError("Folder not found.")
        if node.kind != FileNodeKind.FOLDER:
            raise InvalidInputError("The target parent is a file, not a folder.")
        return node

    def reject_cycle(
        self, node: models.FileNode, new_parent: models.FileNode, *, action: str
    ) -> None:
        """Refuse to move/copy a folder into itself or one of its descendants."""
        cursor: models.FileNode | None = new_parent
        while cursor is not None:
            if cursor.id == node.id:
                raise InvalidInputError(
                    f"Cannot {action} a folder into itself or its own subfolder."
                )
            cursor = self.nodes.get(cursor.parent_id) if cursor.parent_id else None

    def _ingestion_by_file(self, collection_id: UUID) -> dict[UUID, models.Document]:
        """Map file id -> ingestion record for every document in the collection."""
        return {
            document.file_id: document
            for document in self.documents.list_for_collection(collection_id)
            if document.file_id is not None
        }

    @staticmethod
    def _paths_for(nodes: list[models.FileNode]) -> dict[UUID, str]:
        """Compute root-relative display paths (`/reports/q3/file.pdf`)."""
        by_id = {node.id: node for node in nodes}
        paths: dict[UUID, str] = {}

        def path_of(node: models.FileNode) -> str:
            if node.id in paths:
                return paths[node.id]
            parent = by_id.get(node.parent_id) if node.parent_id else None
            prefix = path_of(parent) if parent else ""
            paths[node.id] = f"{prefix}/{node.name}"
            return paths[node.id]

        for node in nodes:
            path_of(node)
        return paths

