"""Wire schemas for the collection file tree (folders, files, search)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.base import DateTimeConfigMixin
from app.schemas.enums import ChunkStrategy, DocumentStatus, FileNodeKind

if TYPE_CHECKING:
    from app.db.models import Document, FileNode


class FileIngestionRead(DateTimeConfigMixin, BaseModel):
    """Ingestion summary for one file: the honest state of its document row.

    Absent entirely (a `FileNodeRead.ingestion` of None) when the file's type
    was never eligible for the collection's ingestion pipeline.
    """

    document_id: UUID
    status: DocumentStatus
    error_message: str | None = None
    warnings: list[str]
    num_chunks: int
    num_tokens: int
    chunk_size: int
    chunk_overlap: int
    chunk_strategy: ChunkStrategy
    embedding_model: str
    ingestion_run_id: UUID | None = None
    updated_at: datetime

    @classmethod
    def from_model(cls, document: Document) -> FileIngestionRead:
        """Build an ingestion summary from a document row."""
        return cls(
            document_id=document.id,
            status=document.status,
            error_message=document.error_message,
            warnings=document.warnings,
            num_chunks=document.num_chunks,
            num_tokens=document.num_tokens,
            chunk_size=document.chunk_size,
            chunk_overlap=document.chunk_overlap,
            chunk_strategy=document.chunk_strategy,
            embedding_model=document.embedding_model,
            ingestion_run_id=document.ingestion_run_id,
            updated_at=document.updated_at,
        )


class FileNodeRead(DateTimeConfigMixin, BaseModel):
    """One node (folder or file) in a collection's file tree."""

    id: UUID
    collection_id: UUID
    parent_id: UUID | None = None
    kind: FileNodeKind
    name: str
    path: str
    content_type: str | None = None
    size_bytes: int
    ingestion: FileIngestionRead | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(
        cls,
        node: FileNode,
        *,
        path: str,
        ingestion: Document | None = None,
    ) -> FileNodeRead:
        """Build a node read model; `path` is computed by the service."""
        return cls(
            id=node.id,
            collection_id=node.collection_id,
            parent_id=node.parent_id,
            kind=node.kind,
            name=node.name,
            path=path,
            content_type=node.content_type,
            size_bytes=node.size_bytes,
            ingestion=FileIngestionRead.from_model(ingestion) if ingestion else None,
            created_at=node.created_at,
            updated_at=node.updated_at,
        )


class FileTreeResponse(BaseModel):
    """The whole tree as a flat node list; clients index by `parent_id`."""

    collection_id: UUID
    nodes: list[FileNodeRead]


class FileListingResponse(BaseModel):
    """One folder's children plus its ancestry — the `ls`-shaped view."""

    parent: FileNodeRead | None = None
    breadcrumb: list[FileNodeRead] = Field(default_factory=list)
    entries: list[FileNodeRead]


class FolderCreate(BaseModel):
    """Request body for creating a folder."""

    name: str = Field(min_length=1, max_length=255)
    parent_id: UUID | None = None


class FileNodeUpdate(BaseModel):
    """Rename and/or move a node.

    `parent_id` moves the node; explicitly passing `null` moves it to the
    collection root (the service distinguishes unset from null via
    `model_fields_set`).
    """

    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_id: UUID | None = None


class FileCopyRequest(BaseModel):
    """Request body for copying a node; `parent_id` null/omitted = root."""

    parent_id: UUID | None = None


class FileUploadResponse(BaseModel):
    """Result of one upload: the file plus any auto-created folders."""

    file: FileNodeRead
    created_folders: list[FileNodeRead] = Field(default_factory=list)


class FileContentMatch(BaseModel):
    """A semantic match inside a file's indexed content."""

    file: FileNodeRead | None = None
    document_id: str
    chunk_id: str
    snippet: str
    score: float


class FileSearchResponse(BaseModel):
    """Grouped search results: folder names, file names, semantic content."""

    query: str
    folders: list[FileNodeRead] = Field(default_factory=list)
    files: list[FileNodeRead] = Field(default_factory=list)
    content: list[FileContentMatch] = Field(default_factory=list)
