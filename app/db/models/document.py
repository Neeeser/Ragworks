"""Document tables: ingested document metadata and stored chunk records."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, String, Text
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import ChunkStrategy, DocumentStatus


class Document(SQLModel, TimestampMixin, table=True):
    """The ingestion record for a file: status, chunk stats, and run lineage.

    One row per ingested (or ingestion-attempted) file, pointed at by
    `file_id` and reused on retry. File identity and hierarchy live on
    `FileNode` (`app/db/models/files.py`); rows created before the file tree
    existed keep their legacy `name`/`content_type`/`source_path` columns as
    the backfill source.
    """

    __tablename__ = "documents"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    file_id: UUID | None = Field(
        default=None,
        foreign_key="file_nodes.id",
        nullable=True,
        index=True,
    )
    name: str = Field(sa_column=Column(String, nullable=False))
    content_type: str = Field(sa_column=Column(String, nullable=False))
    source_path: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    status: DocumentStatus = Field(
        default=DocumentStatus.PENDING,
        sa_column=Column(String, nullable=False),
    )
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    num_chunks: int = Field(default=0, nullable=False)
    num_tokens: int = Field(default=0, nullable=False)
    chunk_size: int = Field(default=1024, nullable=False)
    chunk_overlap: int = Field(default=200, nullable=False)
    chunk_strategy: ChunkStrategy = Field(
        default=ChunkStrategy.TOKEN,
        sa_column=Column(String, nullable=False),
    )
    embedding_model: str = Field(sa_column=Column(String, nullable=False))
    ingestion_run_id: UUID | None = Field(
        default=None,
        foreign_key="pipeline_runs.id",
        nullable=True,
        index=True,
    )


class DocumentChunkRecord(SQLModel, TimestampMixin, table=True):
    """Stored chunk content and embeddings."""

    __tablename__ = "document_chunks"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    chunk_index: int = Field(nullable=False, index=True)
    text: str = Field(sa_column=Column(Text, nullable=False))
    embedding: list[float] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    chunk_metadata: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata", JSON, nullable=False),
    )
    # dead column, drop with next migration pass -- app/db/migrations.py only adds
    # columns (no DROP support), and nothing reads DocumentChunkRecord.score anymore
    # (Pinecone match scores flow through the retrieval schemas instead).
    score: float | None = Field(default=None, nullable=True)
    chunk_size: int = Field(default=0, nullable=False)
    chunk_overlap: int = Field(default=0, nullable=False)
    chunk_strategy: ChunkStrategy = Field(
        default=ChunkStrategy.TOKEN,
        sa_column=Column(String, nullable=False),
    )
    embedding_model: str = Field(sa_column=Column(String, nullable=False))
