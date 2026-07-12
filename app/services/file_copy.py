"""Copying files and folder subtrees within a collection.

A copy re-materializes through the normal ingestion path: stored bytes are
duplicated under each new node's id and every eligible file gets a fresh
pending document row for the background worker — the copy is re-ingested by
the collection's *current* pipeline rather than cloning chunk/vector rows
across backends (which would freeze stale pipeline output and need
per-backend duplication logic).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import FileNodeRepository
from app.schemas.enums import FileNodeKind
from app.services.errors import InvalidInputError
from app.services.files import FileSystemService, is_ingestible
from app.utils.file_storage import FileStorage


@dataclass
class CopyResult:
    """What one copy produced: the new root node and its pending documents."""

    root: models.FileNode
    documents: list[models.Document] = field(default_factory=list)


@dataclass(frozen=True)
class _CopyContext:
    """Invariants shared by every node in one copy operation."""

    user: models.User
    collection: models.Collection
    documents: list[models.Document]


class FileCopyService:
    """Duplicate a file (or folder subtree) into a target folder."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.nodes = FileNodeRepository(session)
        self.fs = FileSystemService(session)
        self.storage = FileStorage()

    def copy(
        self,
        user: models.User,
        collection: models.Collection,
        node: models.FileNode,
        *,
        target_parent_id: UUID | None,
    ) -> CopyResult:
        """Copy `node` under `target_parent_id` (None = collection root).

        The copy's root name is deduped against its new siblings
        (`name (1).ext` style); descendants keep their names because the
        copied folders start empty.
        """
        if target_parent_id is not None:
            parent = self.fs.require_folder(collection.id, target_parent_id)
            if node.kind == FileNodeKind.FOLDER:
                self.fs.reject_cycle(node, parent, action="copy")
        root_name = self.fs.dedupe_name(collection.id, target_parent_id, node.name)
        context = _CopyContext(user=user, collection=collection, documents=[])
        root = self._copy_node(context, node, target_parent_id, root_name)
        self.session.commit()
        self.session.refresh(root)
        return CopyResult(root=root, documents=context.documents)

    def _copy_node(
        self,
        context: _CopyContext,
        source: models.FileNode,
        parent_id: UUID | None,
        name: str,
    ) -> models.FileNode:
        """Clone one node (and, for folders, its children) under `parent_id`."""
        clone = models.FileNode(
            collection_id=context.collection.id,
            user_id=context.user.id,
            parent_id=parent_id,
            kind=source.kind,
            name=name,
            content_type=source.content_type,
        )
        self.nodes.add(clone)
        if source.kind == FileNodeKind.FILE:
            self._copy_bytes(context.collection, source, clone)
            if is_ingestible(clone.content_type):
                context.documents.append(
                    self.fs.ensure_pending_document(context.user, context.collection, clone)
                )
        else:
            for child in self.nodes.list_children(context.collection.id, source.id):
                self._copy_node(context, child, clone.id, child.name)
        return clone

    def _copy_bytes(
        self,
        collection: models.Collection,
        source: models.FileNode,
        clone: models.FileNode,
    ) -> None:
        """Duplicate the stored bytes under the clone's own storage key."""
        if not source.storage_path:
            raise InvalidInputError(f"'{source.name}' has no stored bytes to copy.")
        source_path = Path(source.storage_path)
        if not source_path.is_absolute():
            source_path = self.storage.base_path / source_path
        if not source_path.exists():
            raise InvalidInputError(f"'{source.name}' has no stored bytes to copy.")
        with source_path.open("rb") as stream:
            stored = self.storage.save_stream(
                stream, f"collections/{collection.id}/files/{clone.id}"
            )
        clone.storage_path = str(stored)
        clone.size_bytes = stored.stat().st_size
        self.session.add(clone)
