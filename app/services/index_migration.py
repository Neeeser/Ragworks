"""Startup migration onto first-class index entities (definitions v2 -> v3).

Every stored pipeline version whose definition predates schema version 3 gets
one `RegisteredIndex` row per distinct index it names, and its
`{collection_id}`-style namespace templates converted into checked
expressions.

The definition keeps naming its own indexes: registration makes an index a
selectable entity, it does not move the choice out of the graph. So the
migration is behavior-preserving in the strongest sense — every node targets
the same index after it as before, including a definition whose two dense
stores hold different corpora.

Idempotent by schema version, not by shape: re-dumping stamps version 3, so a
later edit is never undone on the next boot.
"""

from __future__ import annotations

import logging

from sqlmodel import Session

from app.db.repositories import (
    PipelineRepository,
    PipelineVersionRepository,
    RegisteredIndexRepository,
)
from app.pipelines.definition import PipelineDefinition
from app.pipelines.index_identity import collect_index_identities, rewrite_namespace_templates
from app.pipelines.registry import default_registry

logger = logging.getLogger(__name__)

INDEX_ENTITY_SCHEMA_VERSION = 3


def migrate_index_entities(session: Session) -> int:
    """Register pre-v3 definitions' indexes and convert namespaces."""
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
        identities = collect_index_identities(definition, registry)
        for identity in identities:
            indexes.get_or_create(
                pipeline.user_id,
                identity.backend,
                identity.name,
                vector_type=identity.vector_type,
                dimension=identity.dimension if identity.vector_type == "dense" else None,
                metric=identity.metric if identity.vector_type == "dense" else None,
            )
        # Stamped explicitly, because a dumped definition keeps whatever
        # version it was validated from. Without this the row never passes
        # the gate and every boot re-examines every stored version.
        final = rewrite_namespace_templates(definition).model_copy(
            update={"schema_version": INDEX_ENTITY_SCHEMA_VERSION}
        )
        version.definition = final.model_dump(mode="json")
        session.add(version)
        # Every row below the gate is rewritten and stamped, so the count is
        # rows migrated — counting only the ones that gained a registration
        # reports fewer definitions than the boot actually rewrote.
        migrated += 1
    if migrated:
        logger.info("Migrated %d pipeline definitions onto index entities.", migrated)
    session.commit()
    return migrated
