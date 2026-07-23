"""Collection tables: collection metadata and its pipeline bindings."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import BindingRole


class Collection(SQLModel, TimestampMixin, table=True):
    """Collection metadata stored for retrieval.

    Pipelines attach through `CollectionPipelineBinding` rows, never FK
    columns here — the binding table is what lets a collection hold one
    ingest pipeline and any number of tools.
    """

    __tablename__ = "collections"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    system_purpose: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True, index=True),
    )
    extra_metadata: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata", JSON, nullable=False),
    )


class CollectionPipelineBinding(SQLModel, TimestampMixin, table=True):
    """One collection's use of one pipeline, in one role.

    `role` says how the collection uses the pipeline (`ingest` runs on file
    uploads, `tool` is exposed as a callable tool). "At most one ingest row
    per collection" and "exactly one primary among tool rows" are
    service-enforced rules, deliberately not schema constraints, so future
    roles or multiplicity changes never need a migration. `enabled` keeps a
    tool bound but hidden from chat/MCP; `position` is the stable UI and
    tool-listing order.
    """

    __tablename__ = "collection_pipeline_bindings"
    __table_args__ = (
        UniqueConstraint(
            "collection_id",
            "pipeline_id",
            "role",
            name="uq_collection_pipeline_role",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    pipeline_id: UUID = Field(foreign_key="pipelines.id", nullable=False, index=True)
    role: BindingRole = Field(sa_column=Column(String, nullable=False, index=True))
    is_primary: bool = Field(default=False, nullable=False)
    enabled: bool = Field(default=True, nullable=False)
    position: int = Field(default=0, nullable=False)
