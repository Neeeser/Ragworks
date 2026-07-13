"""One-time startup migration onto per-user provider connections.

Runs from the lifespan after `init_db` (which already created the
`provider_connections` table and the new nullable columns). Three idempotent
steps:

1. Move legacy `users.openrouter_api_key` / `users.pinecone_api_key` values
   into `provider_connections` rows and drop the columns. Detected via the
   live table's columns, so upgraded installs migrate once and fresh installs
   skip entirely — and the detection gates every other step, so none of this
   ever reruns after the columns are gone.
2. Rewrite every stored pipeline definition (all versions, pinned ones
   included — a deliberate exception to "node ids are permanent", chosen so
   the retired `embedder.openrouter` id has no live references): the node
   type becomes `embedder.text` and the config gains the owner's OpenRouter
   connection id when one exists.
3. Backfill `chat_sessions.provider_connection_id` from the session owner's
   OpenRouter connection, stamp users' `last_used_chat_connection_id`, and
   purge the removed `models.*` rows from `app_settings`.
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlmodel import Session, col, select

from app.db import models
from app.schemas.enums import ProviderType

logger = logging.getLogger(__name__)

LEGACY_EMBEDDER_TYPE = "embedder.openrouter"
NEW_EMBEDDER_TYPE = "embedder.text"


def migrate_provider_connections(session: Session) -> None:
    """Run the provider-connections migration once (idempotent).

    Every data step is gated on the legacy key columns still existing: on an
    already-migrated (or fresh) install this is a no-op, so a user who later
    deletes a connection is never silently re-pointed at another one on the
    next restart.
    """
    if not _migrate_user_key_columns(session):
        return
    openrouter_by_user = _openrouter_connection_ids(session)
    _rewrite_embedder_nodes(session, openrouter_by_user)
    _backfill_chat_sessions(session, openrouter_by_user)
    _purge_model_default_settings(session)
    session.commit()


def _migrate_user_key_columns(session: Session) -> bool:
    """Move legacy user key columns into connection rows, then drop them.

    Returns True when legacy columns were found (i.e. this boot is the
    migration boot) — the caller gates every other data step on it.
    """
    bind = session.get_bind()
    user_columns = {column["name"] for column in sa_inspect(bind).get_columns("users")}
    legacy_columns = [
        ("openrouter_api_key", ProviderType.OPENROUTER.value, "OpenRouter"),
        ("pinecone_api_key", ProviderType.PINECONE.value, "Pinecone"),
    ]
    present = [entry for entry in legacy_columns if entry[0] in user_columns]
    if not present:
        return False
    logger.info("Migrating legacy user API key columns to provider connections.")
    for column_name, provider_type, label in present:
        rows = session.execute(
            text(f"SELECT id, {column_name} FROM users WHERE {column_name} IS NOT NULL")
        ).all()
        for user_id, api_key in rows:
            key = str(api_key or "").strip()
            if not key:
                continue
            if _has_connection_of_type(session, user_id, provider_type):
                continue
            session.add(
                models.ProviderConnection(
                    user_id=user_id,
                    provider_type=provider_type,
                    label=label,
                    config={"api_key": key},
                )
            )
        session.flush()
    for column_name, _, _ in present:
        session.execute(text(f"ALTER TABLE users DROP COLUMN {column_name}"))
    session.flush()
    return True


def _has_connection_of_type(session: Session, user_id: UUID, provider_type: str) -> bool:
    """True when the user already has a connection of this type."""
    statement = (
        select(models.ProviderConnection.id)
        .where(col(models.ProviderConnection.user_id) == user_id)
        .where(col(models.ProviderConnection.provider_type) == provider_type)
    )
    return session.exec(statement).first() is not None


def _openrouter_connection_ids(session: Session) -> dict[UUID, UUID]:
    """Map each user to their earliest OpenRouter connection, if any."""
    statement = (
        select(models.ProviderConnection)
        .where(
            col(models.ProviderConnection.provider_type)
            == ProviderType.OPENROUTER.value
        )
        .order_by(col(models.ProviderConnection.created_at))
    )
    mapping: dict[UUID, UUID] = {}
    for connection in session.exec(statement).all():
        mapping.setdefault(connection.user_id, connection.id)
    return mapping


def _rewrite_embedder_nodes(
    session: Session, openrouter_by_user: dict[UUID, UUID]
) -> None:
    """Rewrite legacy embedder nodes in every stored pipeline version."""
    pipeline_owners = {
        pipeline.id: pipeline.user_id
        for pipeline in session.exec(select(models.Pipeline)).all()
    }
    rewritten = 0
    for version in session.exec(select(models.PipelineVersion)).all():
        definition = version.definition
        nodes = definition.get("nodes") if isinstance(definition, dict) else None
        if not isinstance(nodes, list):
            continue
        if not any(
            isinstance(node, dict) and node.get("type") == LEGACY_EMBEDDER_TYPE
            for node in nodes
        ):
            continue
        owner_connection = openrouter_by_user.get(pipeline_owners.get(version.pipeline_id, UUID(int=0)))
        new_nodes: list[Any] = []
        for node in nodes:
            if isinstance(node, dict) and node.get("type") == LEGACY_EMBEDDER_TYPE:
                node = {**node, "type": NEW_EMBEDDER_TYPE}
                config = dict(node.get("config") or {})
                if owner_connection is not None and not config.get("connection_id"):
                    config["connection_id"] = str(owner_connection)
                node["config"] = config
            new_nodes.append(node)
        # Reassign, never mutate: JSON columns are not MutableDict-wrapped.
        version.definition = {**definition, "nodes": new_nodes}
        session.add(version)
        rewritten += 1
    if rewritten:
        logger.info("Rewrote %s pipeline version(s) to the %s node.", rewritten, NEW_EMBEDDER_TYPE)
        session.flush()


def _backfill_chat_sessions(
    session: Session, openrouter_by_user: dict[UUID, UUID]
) -> None:
    """Point connection-less chat sessions and users at their OpenRouter connection."""
    statement = select(models.ChatSession).where(
        col(models.ChatSession.provider_connection_id).is_(None)
    )
    for chat_session in session.exec(statement).all():
        connection_id = openrouter_by_user.get(chat_session.user_id)
        if connection_id is None:
            continue
        chat_session.provider_connection_id = connection_id
        session.add(chat_session)
    for user in session.exec(select(models.User)).all():
        if user.last_used_chat_connection_id is None:
            connection_id = openrouter_by_user.get(user.id)
            if connection_id is not None:
                user.last_used_chat_connection_id = connection_id
                session.add(user)
    session.flush()


def _purge_model_default_settings(session: Session) -> None:
    """Delete the removed `models.*` override rows from app_settings."""
    statement = select(models.AppSetting).where(col(models.AppSetting.key).like("models.%"))
    for row in session.exec(statement).all():
        session.delete(row)
    session.flush()
