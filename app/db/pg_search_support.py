"""Process-wide pg_search (ParadeDB BM25) availability flag.

Mirrors `app/db/pgvector_support.py`: whether the Postgres server provides
the `pg_search` extension is a database-level fact, set once at startup by
`app.db.bootstrap.ensure_pg_search_extension` and read by the vectorstores
layer when a sparse (BM25) index is created or queried on the pgvector
backend. Defaults to available so tests and scripts that bootstrap their own
schema don't have to opt in.
"""

from __future__ import annotations

_pg_search_available: bool = True


def set_pg_search_available(available: bool) -> None:
    """Record whether the Postgres server has the pg_search extension."""
    global _pg_search_available  # pylint: disable=global-statement
    _pg_search_available = available


def pg_search_available() -> bool:
    """Return whether the pg_search extension is usable."""
    return _pg_search_available
