"""Database bootstrapping: ensuring the Postgres database and schema exist."""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlmodel import SQLModel, create_engine

from app.db.engine import database_url, engine
from app.db.migrations import apply_missing_columns, ensure_foreign_keys, ensure_indexes
from app.db.pgvector_support import set_pgvector_available
from app.db.schema import SchemaValidationResult, build_expected_schema, inspect_database_schema

logger = logging.getLogger(__name__)


def ensure_pgvector_extension(target_engine: Engine) -> bool:
    """Best-effort `CREATE EXTENSION vector`; record and return availability.

    pgvector is not a trusted extension, so this needs superuser (true for the
    shipped docker-compose bootstrap user). On an external database without
    the extension this logs a warning and marks the pgvector backend
    unavailable instead of failing startup.
    """
    try:
        with target_engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception as exc:  # pylint: disable=broad-exception-caught
        # Deliberately broad: any failure (permissions, extension not
        # installed on the server) means the same thing — pgvector is off.
        logger.warning(
            "pgvector extension unavailable (%s); the pgvector index backend is disabled.",
            exc,
        )
        set_pgvector_available(False)
        return False
    set_pgvector_available(True)
    return True


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


def _format_validation_error(validation: SchemaValidationResult) -> str:
    """Build the error message for a failed schema validation."""
    missing_tables = ", ".join(sorted(validation.missing_tables)) or "none"
    missing_columns = (
        ", ".join(
            f"{table}: {sorted(columns)}"
            for table, columns in validation.missing_columns.items()
        )
        or "none"
    )
    return (
        "Postgres schema validation failed. "
        f"Missing tables: {missing_tables}. Missing columns: {missing_columns}."
    )


def init_db() -> None:
    """Initialize database schema metadata."""
    ensure_database_exists(database_url)
    ensure_pgvector_extension(engine)
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
        raise RuntimeError(_format_validation_error(validation))
