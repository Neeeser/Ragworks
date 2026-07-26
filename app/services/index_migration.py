"""Startup migration onto first-class index entities (definitions v2 -> v3).

Every stored pipeline version whose definition predates schema version 3 gets
its literal index identity rewritten onto binding-source index variables, and
one `RegisteredIndex` row is created per distinct index those definitions
named.

The migration is behavior-preserving by construction: each variable's default
is the literal the definition already carried, so every collection resolves to
exactly the index it resolved to before. That is the property worth testing —
a migration that changes which index a pipeline targets silently detaches a
corpus from its data.

Idempotent by schema version, not by shape: re-dumping stamps version 3, so a
user who later repoints a binding never has the migration undo it on the next
boot.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    PipelineRepository,
    PipelineVersionRepository,
    RegisteredIndexRepository,
)
from app.pipelines.definition import PipelineDefinition
from app.pipelines.index_variables import IndexIdentity, rewrite_index_identity
from app.pipelines.registry import default_registry

logger = logging.getLogger(__name__)

INDEX_ENTITY_SCHEMA_VERSION = 3


def migrate_index_entities(session: Session) -> int:
    """Rewrite pre-v3 definitions onto index variables; return the count."""
    versions = PipelineVersionRepository(session)
    pipelines = PipelineRepository(session)
    registry = default_registry()
    indexes = RegisteredIndexRepository(session)
    migrated = 0
    for version in versions.list_all():
        raw = version.definition
        if not isinstance(raw, dict):
            continue
        if int(raw.get("schema_version", 1)) >= INDEX_ENTITY_SCHEMA_VERSION:
            continue
        pipeline = pipelines.get(version.pipeline_id)
        if pipeline is None:
            continue
        definition = PipelineDefinition.model_validate(raw)
        rewritten = rewrite_index_identity(definition, registry)
        if not rewritten.changed:
            # Nothing store-bound to migrate; stamping the version keeps the
            # gate honest so the row is not re-examined every boot.
            version.definition = definition.model_dump(mode="json")
            session.add(version)
            continue
        ids = _register_identities(indexes, pipeline.user_id, rewritten.identities)
        final = rewrite_index_identity(definition, registry, index_ids=ids)
        version.definition = final.definition.model_dump(mode="json")
        session.add(version)
        migrated += 1
    if migrated:
        logger.info("Migrated %d pipeline definitions onto index entities.", migrated)
    session.commit()
    return migrated


def _register_identities(
    indexes: RegisteredIndexRepository,
    user_id: UUID,
    identities: dict[str, IndexIdentity],
) -> dict[str, UUID]:
    """Register one index row per identity and return `{variable: index id}`.

    `get_or_create` is what makes two pipelines naming the same index share
    one row — the whole point of the entity, and what lets the Index Manager
    answer "who uses this?".
    """
    resolved: dict[str, UUID] = {}
    for variable, identity in identities.items():
        row = indexes.get_or_create(
            user_id,
            identity.backend,
            identity.name,
            vector_type=identity.vector_type,
            dimension=identity.dimension if identity.vector_type == "dense" else None,
            metric=identity.metric if identity.vector_type == "dense" else None,
        )
        resolved[variable] = row.id
    return resolved


def registered_index_for(
    session: Session,
    user: models.User,
    identity: IndexIdentity,
) -> models.RegisteredIndex:
    """Register (or fetch) the row for one index identity."""
    return RegisteredIndexRepository(session).get_or_create(
        user.id,
        identity.backend,
        identity.name,
        vector_type=identity.vector_type,
        dimension=identity.dimension if identity.vector_type == "dense" else None,
        metric=identity.metric if identity.vector_type == "dense" else None,
    )
