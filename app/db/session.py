"""Database session management and initialization."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Iterator, cast

from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlmodel import Session, SQLModel, create_engine

from app.api.config import get_settings
from app.db.migrations import apply_missing_columns, ensure_foreign_keys, ensure_indexes
from app.db.schema import SchemaValidationResult, build_expected_schema, inspect_database_schema

settings = get_settings()
logger = logging.getLogger(__name__)

database_url = cast(str, settings.database_url)
engine = create_engine(database_url, pool_pre_ping=True)


def _safe_database_name(raw_name: str) -> str:
    """Return a safely quoted Postgres database name."""
    return raw_name.replace('"', '""')


def ensure_database_exists(target_url: str) -> None:
    """Ensure the configured Postgres database exists, creating it if needed."""
    url = make_url(target_url)
    if not url.database:
        raise ValueError("DATABASE_URL must include a database name.")

    admin_url = url.set(database="postgres")
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)
    try:
        with admin_engine.connect() as connection:
            result = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :database"),
                {"database": url.database},
            ).first()
            if result:
                return
            safe_name = _safe_database_name(url.database)
            connection.execute(text(f'CREATE DATABASE "{safe_name}"'))
            logger.info("Created Postgres database %s", url.database)
    finally:
        admin_engine.dispose()


def init_db() -> None:
    """Initialize database schema metadata."""
    # Import inside to ensure models are registered before table creation.
    import app.db.models  # pylint: disable=import-outside-toplevel,unused-import

    ensure_database_exists(database_url)
    expected = build_expected_schema()
    actual = inspect_database_schema(engine)
    validation = SchemaValidationResult.from_schemas(expected, actual)
    if validation.missing_tables:
        logger.info("Initializing missing Postgres tables.")
        SQLModel.metadata.create_all(engine)
        actual = inspect_database_schema(engine)
        validation = SchemaValidationResult.from_schemas(expected, actual)
    if validation.missing_columns:
        logger.info("Applying Postgres schema migrations for missing columns.")
        apply_missing_columns(engine, validation.missing_columns)
        actual = inspect_database_schema(engine)
        validation = SchemaValidationResult.from_schemas(expected, actual)
    ensure_indexes(engine)
    ensure_foreign_keys(engine)
    if not validation.is_valid:
        missing_tables = ", ".join(sorted(validation.missing_tables)) or "none"
        missing_columns_map = cast(dict[str, set[str]], validation.missing_columns)
        missing_columns = ", ".join(
            f"{table}: {sorted(columns)}" for table, columns in missing_columns_map.items()  # pylint: disable=no-member
        ) or "none"
        raise RuntimeError(
            "Postgres schema validation failed. "
            f"Missing tables: {missing_tables}. Missing columns: {missing_columns}."
        )


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
