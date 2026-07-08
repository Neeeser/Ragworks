"""Catalog of pgvector-backed logical indexes.

The vector data itself lives in one dynamically created table per index
(`vec_<name>`, owned by `app/vectorstores/pgvector/repository.py`); this
catalog row records the parameters (dimension, metric) that DDL was created
with, so listing/describing indexes never needs to introspect pg_catalog.
"""

from __future__ import annotations

from sqlalchemy import Column, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class VectorIndexRecord(SQLModel, TimestampMixin, table=True):
    """One pgvector logical index and the parameters its table was built with."""

    __tablename__ = "vector_indexes"

    name: str = Field(sa_column=Column(String, primary_key=True))
    dimension: int
    metric: str
