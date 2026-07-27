"""The startup migration sequence, in the one order that works.

The steps are ordered, not merely grouped, and the constraint is not obvious
from any single step: `collapse_index_slots` reads raw stored JSON precisely
because a binding-source variable is no longer a valid `VariableSource`, while
`upgrade_stored_pipeline_definitions` and `migrate_index_entities` both parse
every stored version through `PipelineDefinition`. Run either of those first
and a database still holding the old shape raises `ValidationError` during
startup — the app never boots, and the migration that would have fixed the row
never runs.

So: every migration that *rewrites a definition out of a shape the schema can
no longer parse* runs before every migration that *parses definitions*.
"""

from __future__ import annotations

from sqlmodel import Session

from app.services.accounts import ensure_admin_exists
from app.services.binding_migration import migrate_pipeline_bindings
from app.services.file_backfill import backfill_file_nodes
from app.services.index_migration import migrate_index_entities
from app.services.pipelines import (
    backfill_default_pipelines,
    upgrade_stored_pipeline_definitions,
)
from app.services.provider_migration import migrate_provider_connections
from app.services.slot_collapse_migration import collapse_index_slots
from app.services.tokenizer_migration import migrate_tokenizer_nodes


def run_startup_migrations(session: Session) -> None:
    """Bring stored rows up to the shapes the running code expects."""
    migrate_provider_connections(session)
    # Before any definition parsing: it needs the binding rows, and it is the
    # step that removes the unparseable binding-source variables.
    migrate_pipeline_bindings(session)
    collapse_index_slots(session)

    migrate_tokenizer_nodes(session)
    upgrade_stored_pipeline_definitions(session)
    migrate_index_entities(session)

    backfill_default_pipelines(session)
    backfill_file_nodes(session)
    ensure_admin_exists(session)
