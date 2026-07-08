"""Process-wide pgvector availability flag.

Whether the Postgres server has the `vector` extension is a database-level
fact, so the flag lives in `app/db` (the vectorstores registry — a higher
layer — reads it; the import direction stays `db ← domain packages`). Set
once at startup by `app.db.bootstrap.ensure_pgvector_extension`. Defaults to
available so tests and scripts that bootstrap their own schema don't have to
opt in.
"""

from __future__ import annotations

_pgvector_available: bool = True


def set_pgvector_available(available: bool) -> None:
    """Record whether the Postgres server has the pgvector extension."""
    global _pgvector_available  # pylint: disable=global-statement
    _pgvector_available = available


def pgvector_available() -> bool:
    """Return whether the pgvector extension is usable."""
    return _pgvector_available
