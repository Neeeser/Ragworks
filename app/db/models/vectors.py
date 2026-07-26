"""Catalog of pgvector-backed logical indexes.

The vector data itself lives in one dynamically created table per index
(dense: `vec_<name>`; sparse/BM25: `lex_<name>`, both owned by
`app/vectorstores/pgvector/repository.py`); this catalog row records the
parameters that DDL was created with, so listing/describing indexes never
needs to introspect pg_catalog.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class VectorIndexRecord(SQLModel, TimestampMixin, table=True):
    """One pgvector logical index and the parameters its table was built with.

    Dense indexes carry a dimension and metric; sparse (BM25) indexes carry
    neither dimension (their vocabulary is unbounded) nor a dense metric —
    `metric` records `"bm25"` for them, purely descriptive.

    `owner_user_id` records who created the index through the app, so the
    catalog listing can be scoped per account. It is nullable on purpose and
    means "no owner recorded": rows that predate the column, and indexes
    created straight in Postgres, stay visible to everyone so they remain
    adoptable rather than vanishing from the registry.
    """

    __tablename__ = "vector_indexes"

    name: str = Field(sa_column=Column(String, primary_key=True))
    dimension: int | None = None
    metric: str
    vector_type: str = Field(default="dense")
    owner_user_id: UUID | None = Field(default=None, index=True)
