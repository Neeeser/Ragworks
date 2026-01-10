"""Shared test helpers for Postgres-backed SQLModel sessions."""

from __future__ import annotations

import os
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from app.db.session import ensure_database_exists

DEFAULT_TEST_DATABASE_URL = "postgresql+psycopg://localhost:5432/transparentrag_test"


def get_database_url() -> str:
    """Return the database URL to use for tests."""
    return os.getenv("DATABASE_URL", DEFAULT_TEST_DATABASE_URL)


def create_test_engine() -> Engine:
    """Create a SQLModel engine for the test database."""
    return create_engine(get_database_url(), pool_pre_ping=True)


def reset_database(engine: Engine) -> None:
    """Drop and recreate all tables for a clean test database."""
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    SQLModel.metadata.create_all(engine)


def open_session() -> Iterator[Session]:
    """Yield a SQLModel session backed by a reset test database."""
    ensure_database_exists(get_database_url())
    engine = create_test_engine()
    reset_database(engine)
    with Session(engine) as session:
        yield session
