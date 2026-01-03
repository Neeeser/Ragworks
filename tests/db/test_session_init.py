from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.engine.url import make_url
from sqlmodel import SQLModel, create_engine

from app.db.schema import SchemaValidationResult, build_expected_schema, inspect_database_schema
from app.db.session import ensure_database_exists, init_db, engine as app_engine


def test_ensure_database_exists_requires_database_name() -> None:
    with pytest.raises(ValueError, match="DATABASE_URL must include a database name"):
        ensure_database_exists("postgresql+psycopg://localhost")


def test_init_db_raises_for_invalid_schema(monkeypatch) -> None:
    class _StubValidation:
        missing_tables = {"missing"}
        missing_columns = {"table": {"column"}}

        @property
        def is_valid(self) -> bool:
            return False

    monkeypatch.setattr("app.db.session.ensure_database_exists", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.db.session.build_expected_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.db.session.inspect_database_schema", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.db.session.SchemaValidationResult.from_schemas", lambda *_args, **_kwargs: _StubValidation())
    monkeypatch.setattr("app.db.session.apply_missing_columns", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.db.session.ensure_indexes", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.db.session.ensure_foreign_keys", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.db.session.SQLModel.metadata.create_all", lambda *_args, **_kwargs: None)

    with pytest.raises(RuntimeError, match="Postgres schema validation failed"):
        init_db()


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
