"""Collection table: metadata for a user's retrieval-ready document set."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, String, Text
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class Collection(SQLModel, TimestampMixin, table=True):
    """Collection metadata stored for retrieval."""

    __tablename__ = "collections"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    ingestion_pipeline_id: UUID | None = Field(
        default=None,
        foreign_key="pipelines.id",
        nullable=True,
        index=True,
    )
    retrieval_pipeline_id: UUID | None = Field(
        default=None,
        foreign_key="pipelines.id",
        nullable=True,
        index=True,
    )
    system_purpose: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True, index=True),
    )
    extra_metadata: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata", JSON, nullable=False),
    )
