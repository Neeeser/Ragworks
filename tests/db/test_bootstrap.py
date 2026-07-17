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
from sqlmodel import Session, SQLModel, create_engine

from app.db import models
from app.db.bootstrap import _format_validation_error, ensure_database_exists, init_db
from app.db.engine import engine as app_engine
from app.db.schema import SchemaValidationResult, build_expected_schema, inspect_database_schema
from app.schemas.enums import UserRole


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
    # render_as_string(hide_password=False): str(url) masks the password as
    # "***", which breaks reconnection against password-authed Postgres (CI).
    base_url = app_engine.url.render_as_string(hide_password=False)
    unique_name = f"ragworks_tmp_{uuid4().hex[:8]}"
    target_url = make_url(base_url).set(database=unique_name).render_as_string(hide_password=False)

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


def test_init_db_backfills_string_server_default_as_literal() -> None:
    """Adding a non-nullable string-defaulted column to a populated table
    backfills the literal default value, not a same-named SQL keyword.

    Regression test for a real bug in `_resolve_default_sql`: a plain Python
    string passed to `server_default=` (as `User.role` does, with
    `UserRole.USER.value == "user"`) used to be emitted verbatim as SQL text
    (`DEFAULT user`) instead of a quoted literal (`DEFAULT 'user'`). Postgres
    parses the unquoted form as the `user`/`CURRENT_USER` function, so
    existing rows backfilled to the connecting role's name (e.g. "ragworks")
    instead of the literal string "user".
    """
    SQLModel.metadata.drop_all(app_engine)
    SQLModel.metadata.create_all(app_engine)

    with Session(app_engine) as session:
        user = models.User(
            email="backfill@example.com",
            hashed_password="hashed",
        )
        session.add(user)
        session.commit()
        user_id = user.id

    with app_engine.begin() as connection:
        connection.execute(text("ALTER TABLE users DROP COLUMN IF EXISTS role"))

    init_db()

    with Session(app_engine) as session:
        fresh = session.get(models.User, user_id)
        assert fresh is not None
        assert fresh.role == UserRole.USER.value


def test_init_db_backfills_legacy_chunk_token_counts() -> None:
    """Existing chunks receive a sortable word-count fallback."""
    SQLModel.metadata.drop_all(app_engine)
    SQLModel.metadata.create_all(app_engine)

    with Session(app_engine) as session:
        user = models.User(email="chunks@example.com", hashed_password="hashed")
        session.add(user)
        session.flush()
        collection = models.Collection(
            user_id=user.id,
            name="Chunks",
            description="",
            extra_metadata={},
        )
        session.add(collection)
        session.flush()
        document = models.Document(
            collection_id=collection.id,
            user_id=user.id,
            name="chunk.txt",
            content_type="text/plain",
            embedding_model="embed",
        )
        session.add(document)
        session.flush()
        session.add(
            models.DocumentChunkRecord(
                document_id=document.id,
                collection_id=collection.id,
                chunk_index=0,
                text="three word chunk",
                embedding=[],
                chunk_metadata={},
                chunk_size=1,
                chunk_overlap=0,
                chunk_strategy=models.ChunkStrategy.TOKEN,
                embedding_model="embed",
            )
        )
        session.commit()

    with app_engine.begin() as connection:
        connection.execute(text("ALTER TABLE document_chunks DROP COLUMN token_count"))

    init_db()

    with app_engine.connect() as connection:
        token_count = connection.execute(
            text("SELECT token_count FROM document_chunks")
        ).scalar_one()
    assert token_count == 3


def test_init_db_backfills_warning_lists_on_populated_tables() -> None:
    """Existing document and trace rows receive empty warning lists."""
    SQLModel.metadata.drop_all(app_engine)
    SQLModel.metadata.create_all(app_engine)

    with Session(app_engine) as session:
        user = models.User(email="warnings@example.com", hashed_password="hashed")
        session.add(user)
        session.flush()
        collection = models.Collection(
            user_id=user.id,
            name="Warnings",
            description="",
            extra_metadata={},
        )
        pipeline = models.Pipeline(
            user_id=user.id,
            name="Warnings",
            kind=models.PipelineKind.INGESTION,
            current_version=1,
        )
        session.add(collection)
        session.add(pipeline)
        session.flush()
        document = models.Document(
            collection_id=collection.id,
            user_id=user.id,
            name="document.txt",
            content_type="text/plain",
            embedding_model="embed",
        )
        run = models.PipelineRun(
            pipeline_id=pipeline.id,
            kind=models.PipelineKind.INGESTION,
            user_id=user.id,
            collection_id=collection.id,
            status=models.PipelineRunStatus.RUNNING,
        )
        session.add(document)
        session.add(run)
        session.commit()
        document_id = document.id
        run_id = run.id

    with app_engine.begin() as connection:
        connection.execute(text("ALTER TABLE documents DROP COLUMN warnings"))
        connection.execute(text("ALTER TABLE pipeline_runs DROP COLUMN warnings"))

    init_db()

    with Session(app_engine) as fresh_session:
        fresh_document = fresh_session.get(models.Document, document_id)
        fresh_run = fresh_session.get(models.PipelineRun, run_id)
        assert fresh_document is not None
        assert fresh_run is not None
        assert fresh_document.warnings == []
        assert fresh_run.warnings == []


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
