"""Catalog of pgvector-backed logical indexes.

The vector data itself lives in one dynamically created table per index
(dense: `vec_<name>`; sparse/BM25: `lex_<name>`, both owned by
`app/vectorstores/pgvector/repository.py`); this catalog row records the
parameters that DDL was created with, so listing/describing indexes never
needs to introspect pg_catalog.
"""

from __future__ import annotations

from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class VectorIndexRecord(SQLModel, TimestampMixin, table=True):
    """One pgvector logical index and the parameters its table was built with.

    Dense indexes carry a dimension and metric; sparse (BM25) indexes carry
    neither dimension (their vocabulary is unbounded) nor a dense metric —
    `metric` records `"bm25"` for them, purely descriptive.
    """

    __tablename__ = "vector_indexes"

    name: str = Field(sa_column=Column(String, primary_key=True))
    dimension: int | None = None
    metric: str
    vector_type: str = Field(default="dense")
