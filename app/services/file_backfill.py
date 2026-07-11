"""Backfill file-tree nodes for documents that predate the file tree."""

from __future__ import annotations

from pathlib import Path

from sqlmodel import Session

from app.db import models
from app.db.repositories import DocumentRepository
from app.schemas.enums import FileNodeKind
from app.services.files import FileSystemService


def backfill_file_nodes(session: Session) -> None:
    """Create root-level file nodes for documents with no `file_id` yet.

    Runs from the app lifespan after `init_db`; idempotent because it only
    touches documents whose `file_id` is still NULL.
    """
    documents = DocumentRepository(session)
    service = FileSystemService(session)
    for document in documents.list_missing_file():
        size = 0
        if document.source_path:
            source = Path(document.source_path)
            if source.exists():
                size = source.stat().st_size
        node = models.FileNode(
            collection_id=document.collection_id,
            user_id=document.user_id,
            parent_id=None,
            kind=FileNodeKind.FILE,
            name=service.dedupe_name(document.collection_id, None, document.name),
            content_type=document.content_type,
            size_bytes=size,
            storage_path=document.source_path,
        )
        session.add(node)
        session.flush()
        document.file_id = node.id
        session.add(document)
    session.commit()
