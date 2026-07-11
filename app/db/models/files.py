"""File-tree tables: hierarchical folders and files owned by a collection.

A `FileNode` is identity and hierarchy only — where a file lives and what it
is. Whether (and how) a file was *ingested* is the `Document` row that points
back at it via `documents.file_id`; a file with no document row was never
eligible for the collection's ingestion pipeline.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import FileNodeKind


class FileNode(SQLModel, TimestampMixin, table=True):
    """One node (folder or file) in a collection's file tree.

    Hierarchy is an adjacency list: `parent_id` points at the containing
    folder, `NULL` means the node sits at the collection root. Sibling-name
    uniqueness per `(collection_id, parent_id, name)` is enforced in
    `FileSystemService` (Postgres unique indexes treat NULL parents as
    distinct rows, so a database constraint can't cover root siblings).
    """

    __tablename__ = "file_nodes"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    parent_id: UUID | None = Field(
        default=None,
        foreign_key="file_nodes.id",
        nullable=True,
        index=True,
    )
    kind: FileNodeKind = Field(sa_column=Column(String, nullable=False))
    name: str = Field(sa_column=Column(String, nullable=False))
    content_type: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    size_bytes: int = Field(default=0, nullable=False)
    storage_path: str | None = Field(default=None, sa_column=Column(String, nullable=True))
