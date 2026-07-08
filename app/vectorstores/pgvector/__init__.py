"""pgvector backend: vectors stored in the app's own Postgres."""

from app.vectorstores.pgvector.store import PGVECTOR_CAPABILITIES, PgvectorStore

__all__ = ["PGVECTOR_CAPABILITIES", "PgvectorStore"]
