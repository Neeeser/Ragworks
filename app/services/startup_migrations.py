"""The startup migration sequence, in the one order that works.

The steps are ordered, not merely grouped, and the constraint is not obvious
from any single step: `upgrade_stored_pipeline_definitions` and
`migrate_index_entities` parse every stored version through
`PipelineDefinition`, so anything that rewrites a definition *out of a shape
the schema can no longer parse* must run before them. Such a step reads raw
stored JSON rather than the model — validating the row it exists to fix would
raise first, in `lifespan`, where the app never boots and retrying never
helps.

The sequence lives here rather than in `lifespan` so that constraint is
stated, and satisfied, in one place.
"""

from __future__ import annotations

from sqlmodel import Session

from app.services.accounts import ensure_admin_exists
from app.services.binding_migration import migrate_pipeline_bindings
from app.services.file_backfill import backfill_file_nodes
from app.services.index_migration import migrate_index_entities
from app.services.insight_migration import migrate_insight_settings
from app.services.llm_throttle_migration import stamp_llm_throttle_defaults
from app.services.pipelines import (
    backfill_default_pipelines,
    upgrade_stored_pipeline_definitions,
)
from app.services.provider_migration import migrate_provider_connections
from app.services.tokenizer_migration import migrate_tokenizer_nodes


def run_startup_migrations(session: Session) -> None:
    """Bring stored rows up to the shapes the running code expects."""
    migrate_provider_connections(session)
    stamp_llm_throttle_defaults(session)
    migrate_pipeline_bindings(session)
    migrate_insight_settings(session)

    migrate_tokenizer_nodes(session)
    upgrade_stored_pipeline_definitions(session)
    migrate_index_entities(session)

    backfill_default_pipelines(session)
    backfill_file_nodes(session)
    ensure_admin_exists(session)
