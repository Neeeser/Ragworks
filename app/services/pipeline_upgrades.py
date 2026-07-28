"""Startup migrations for stored pipeline definitions."""

from sqlmodel import Session

from app.db.repositories import (
    PipelineRepository,
    PipelineVersionRepository,
    UserRepository,
)
from app.pipelines.chunk_window_upgrade import rebase_chunk_windows
from app.pipelines.definition import PipelineDefinition
from app.pipelines.upgrades import migrate_variables_definition, upgrade_definition
from app.services.pipeline_validation import (
    log_pipeline_validation_warnings,
    validate_pipeline_definition,
)

#: Definitions stored below this version predate additive chunk overlap.
CHUNK_WINDOW_SCHEMA_VERSION = 4


def upgrade_stored_pipeline_definitions(session: Session) -> int:
    """Rewrite stored pipeline versions to the current definition shape.

    Two passes per version: the node-vocabulary rewrite (shape-driven), and
    the variables v1 -> v2 migration, gated by the raw stored dict *lacking*
    ``schema_version`` — re-dumping stamps the current version, so a row is
    only ever migrated once (a user deleting a migrated Result Limit node later must
    never see it reinserted on the next boot).
    """
    versions = PipelineVersionRepository(session)
    pipelines = PipelineRepository(session)
    users = UserRepository(session)
    upgraded_count = 0
    for version in versions.list_all():
        raw = version.definition
        needs_variables_migration = isinstance(raw, dict) and "schema_version" not in raw
        # Rebasing twice would shrink every chunk window again, so this is
        # gated by the stored version; re-dumping stamps the current one.
        stored_version = raw.get("schema_version", 1) if isinstance(raw, dict) else 1
        needs_chunk_rebase = (
            isinstance(stored_version, int) and stored_version < CHUNK_WINDOW_SCHEMA_VERSION
        )
        definition = PipelineDefinition.model_validate(raw)
        upgraded = upgrade_definition(definition)
        changed = upgraded is not None
        definition = upgraded or definition
        if needs_variables_migration:
            definition = migrate_variables_definition(definition)
            changed = True
        if needs_chunk_rebase:
            definition = rebase_chunk_windows(definition)
            changed = True
        if not changed:
            continue
        version.definition = definition.model_dump(mode="json")
        session.add(version)
        pipeline = pipelines.get(version.pipeline_id)
        user = users.get(pipeline.user_id) if pipeline is not None else None
        if user is not None:
            result = validate_pipeline_definition(session, user, definition)
            log_pipeline_validation_warnings(result, context="stored-definition upgrade")
        upgraded_count += 1
    return upgraded_count
