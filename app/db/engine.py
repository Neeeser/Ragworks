"""Database engine and session management.

The module-level engine is a deliberate exception to the "no import-time side
effects" rule: a single process-wide `Engine` is created once at import time
and reused for the life of the process, matching SQLAlchemy's own guidance.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlmodel import Session, create_engine

from app.core.config import get_settings

settings = get_settings()

database_url = settings.database_url
engine = create_engine(database_url, pool_pre_ping=True)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Provide a transactional scope around a series of operations."""
    session = Session(engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """Yield a database session for dependency injection."""
    with session_scope() as session:
        yield session


@contextmanager
def stream_scoped_session() -> Iterator[Session]:
    """Yield a session for a streaming response and close it exactly once.

    Unlike `session_scope`, it neither commits nor rolls back: a streaming chat
    turn manages its own commits, and this only guarantees the session is
    released when the response finishes (or when setup fails before streaming
    starts). The streaming generator outlives its request handler, so the
    caller transfers ownership of this scope (via `ExitStack.pop_all`) and
    closes it from the generator's `finally`.
    """
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()
