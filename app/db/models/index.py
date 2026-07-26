"""Registered vector indexes: the app-level identity of an index.

A `RegisteredIndex` is what a pipeline points at. It is deliberately separate
from `VectorIndexRecord` (`app/db/models/vectors.py`), which is the pgvector
backend's own catalog of the tables it created: this row is user-owned,
spans every backend, and exists so a binding can name an index without
embedding its identity in a pipeline definition.

Registration is what makes an index pickable. An index can exist physically
without a row (created directly in Pinecone, or by an older deployment), which
the Index Manager surfaces as adoptable rather than hiding — a name a user
cannot see is a name they cannot stop a pipeline from silently creating.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import Column, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import IndexBackend


class RegisteredIndex(SQLModel, TimestampMixin, table=True):
    """One index a user has registered, on one backend.

    `(user_id, backend, name)` is unique: a name identifies one index within a
    backend, and two rows for it would let two bindings disagree about the
    same physical store. `dimension` and `metric` describe dense indexes;
    sparse (BM25) indexes carry neither, so both stay null for them.
    """

    __tablename__ = "registered_indexes"
    __table_args__ = (
        UniqueConstraint("user_id", "backend", "name", name="uq_registered_index_identity"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    backend: IndexBackend = Field(sa_column=Column(String, nullable=False, index=True))
    name: str = Field(sa_column=Column(String, nullable=False, index=True))
    vector_type: str = Field(default="dense", nullable=False)
    dimension: int | None = Field(default=None)
    metric: str | None = Field(default=None)
