"""Startup migration onto provider connections, against real Postgres.

Simulates a pre-upgrade database by re-adding the legacy user key columns and
seeding legacy-shaped rows, then asserts the migration's observable outcomes:
connection rows, rewritten pipeline definitions, chat-session backfill,
dropped columns, and purged `models.*` settings.
"""

from __future__ import annotations

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import AppSettingRepository, ProviderConnectionRepository
from app.services.provider_migration import migrate_provider_connections


def _add_legacy_columns(session: Session) -> None:
    session.execute(text("ALTER TABLE users ADD COLUMN openrouter_api_key TEXT"))
    session.execute(text("ALTER TABLE users ADD COLUMN pinecone_api_key TEXT"))
    session.commit()


def _legacy_user(session: Session, *, openrouter: str | None, pinecone: str | None) -> models.User:
    user = models.User(email="legacy@example.com", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    session.execute(
        text(
            "UPDATE users SET openrouter_api_key = :orkey, pinecone_api_key = :pckey "
            "WHERE id = :uid"
        ),
        {"orkey": openrouter, "pckey": pinecone, "uid": user.id},
    )
    session.commit()
    return user


def _legacy_pipeline(session: Session, user: models.User) -> models.PipelineVersion:
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Legacy Ingestion",
        description="",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
        is_default=True,
    )
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    version = models.PipelineVersion(
        pipeline_id=pipeline.id,
        version=1,
        definition={
            "nodes": [
                {
                    "id": "embed-chunks",
                    "type": "embedder.openrouter",
                    "name": "Embedder",
                    "position": {"x": 0, "y": 0},
                    "config": {"model_name": "openai/text-embedding-3-small"},
                }
            ],
            "edges": [],
            "viewport": {},
        },
        change_summary="legacy",
    )
    session.add(version)
    session.commit()
    session.refresh(version)
    return version


def test_migration_moves_keys_rewrites_nodes_and_backfills(session: Session) -> None:
    _add_legacy_columns(session)
    user = _legacy_user(session, openrouter="sk-or-legacy", pinecone="pcsk_legacy")
    version = _legacy_pipeline(session, user)
    chat_session = models.ChatSession(user_id=user.id, title="Old chat", chat_model="m")
    session.add(chat_session)
    AppSettingRepository(session).upsert(
        "models.default_embedding_model", "openai/text-embedding-3-small", updated_by=None
    )
    session.commit()

    migrate_provider_connections(session)

    with Session(session.get_bind()) as fresh:
        connections = ProviderConnectionRepository(fresh).list_for_user(user.id)
        by_type = {connection.provider_type: connection for connection in connections}
        assert by_type["openrouter"].config == {"api_key": "sk-or-legacy"}
        assert by_type["pinecone"].config == {"api_key": "pcsk_legacy"}

        migrated_version = fresh.get(models.PipelineVersion, version.id)
        assert migrated_version is not None
        node = migrated_version.definition["nodes"][0]
        assert node["type"] == "embedder.text"
        assert node["config"]["connection_id"] == str(by_type["openrouter"].id)
        assert node["config"]["model_name"] == "openai/text-embedding-3-small"

        migrated_session = fresh.get(models.ChatSession, chat_session.id)
        assert migrated_session is not None
        assert migrated_session.provider_connection_id == by_type["openrouter"].id

        migrated_user = fresh.get(models.User, user.id)
        assert migrated_user is not None
        assert migrated_user.last_used_chat_connection_id == by_type["openrouter"].id

        columns = {c["name"] for c in sa_inspect(fresh.get_bind()).get_columns("users")}
        assert "openrouter_api_key" not in columns
        assert "pinecone_api_key" not in columns

        assert AppSettingRepository(fresh).all_overrides() == {}


def test_migration_is_idempotent_and_skips_fresh_installs(session: Session) -> None:
    user = models.User(email="fresh@example.com", hashed_password="hashed")
    session.add(user)
    session.commit()

    migrate_provider_connections(session)
    migrate_provider_connections(session)

    with Session(session.get_bind()) as fresh:
        assert ProviderConnectionRepository(fresh).list_for_user(user.id) == []


def test_migration_leaves_definitions_without_owner_connection_flagged(
    session: Session,
) -> None:
    """A legacy pipeline whose owner had no key gets the new node type but no
    connection id — node validation surfaces it for a manual fix-up."""
    _add_legacy_columns(session)
    user = _legacy_user(session, openrouter=None, pinecone=None)
    version = _legacy_pipeline(session, user)

    migrate_provider_connections(session)

    with Session(session.get_bind()) as fresh:
        migrated = fresh.get(models.PipelineVersion, version.id)
        assert migrated is not None
        node = migrated.definition["nodes"][0]
        assert node["type"] == "embedder.text"
        assert "connection_id" not in node["config"]
        assert fresh.exec(select(models.ProviderConnection)).all() == []
