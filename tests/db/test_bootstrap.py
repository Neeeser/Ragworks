"""Bootstrap tests.

`test_init_db_raises_for_invalid_schema` (mocked 8 internals of `init_db` to
force `is_valid=False`) was deleted rather than kept or replaced with a live
case: `init_db` heals every schema gap `SchemaValidationResult` can detect —
`create_all` for missing tables, `apply_missing_columns` for missing columns
— both driven from the same `SQLModel.metadata` the validator compares
against, so a live Postgres run cannot be coaxed into an unhealable state
cheaply; the mocked test exercised only the RuntimeError-formatting branch.
That branch's real behavior (the message contents) is covered directly and
without mocking by `test_format_validation_error_lists_missing_tables_and_columns`
below.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlmodel import SQLModel, create_engine

from app.db.bootstrap import _format_validation_error, ensure_database_exists, init_db
from app.db.engine import engine as app_engine
from app.db.schema import SchemaValidationResult, build_expected_schema, inspect_database_schema


def test_ensure_database_exists_requires_database_name() -> None:
    with pytest.raises(ValueError, match="DATABASE_URL must include a database name"):
        ensure_database_exists("postgresql+psycopg://localhost")


def test_format_validation_error_lists_missing_tables_and_columns() -> None:
    validation = SchemaValidationResult(
        missing_tables={"widgets"},
        missing_columns={"users": {"nickname"}},
    )

    message = _format_validation_error(validation)

    assert "widgets" in message
    assert "users" in message
    assert "nickname" in message


def _admin_engine(database_url: str):
    url = make_url(database_url)
    admin_url = url.set(database="postgres")
    return create_engine(admin_url, isolation_level="AUTOCOMMIT", pool_pre_ping=True)


def _database_exists(admin_engine, db_name: str) -> bool:
    with admin_engine.connect() as connection:
        return (
            connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :database"),
                {"database": db_name},
            ).first()
            is not None
        )


def test_ensure_database_exists_creates_database() -> None:
    base_url = str(app_engine.url)
    unique_name = f"transparentrag_tmp_{uuid4().hex[:8]}"
    target_url = str(make_url(base_url).set(database=unique_name))

    admin_engine = _admin_engine(base_url)
    try:
        ensure_database_exists(target_url)
        assert _database_exists(admin_engine, unique_name)
    finally:
        with admin_engine.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{unique_name}"'))
        admin_engine.dispose()


def test_init_db_creates_missing_tables() -> None:
    SQLModel.metadata.drop_all(app_engine)

    init_db()

    expected = build_expected_schema()
    actual = inspect_database_schema(app_engine)
    result = SchemaValidationResult.from_schemas(expected, actual)

    assert result.is_valid


def test_init_db_adds_missing_columns() -> None:
    SQLModel.metadata.drop_all(app_engine)
    SQLModel.metadata.create_all(app_engine)

    with app_engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE collections DROP COLUMN IF EXISTS ingestion_pipeline_id")
        )
        connection.execute(
            text("ALTER TABLE collections DROP COLUMN IF EXISTS retrieval_pipeline_id")
        )

    init_db()

    expected = build_expected_schema()
    actual = inspect_database_schema(app_engine)
    result = SchemaValidationResult.from_schemas(expected, actual)

    assert result.is_valid


def test_collections_schema_excludes_pipeline_models() -> None:
    init_db()
    actual = inspect_database_schema(app_engine)
    collection_schema = actual.tables.get("collections")
    assert collection_schema is not None
    excluded = {
        "embedding_model",
        "chat_model",
        "context_window",
        "chunk_size",
        "chunk_overlap",
        "chunk_strategy",
        "pinecone_index",
        "pinecone_namespace",
    }
    assert excluded.isdisjoint(collection_schema.columns)
