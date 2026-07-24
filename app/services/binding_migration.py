"""One-time startup migration onto collection pipeline bindings.

Runs from the lifespan after `init_db` (which already created the
`collection_pipeline_bindings` table and the new nullable columns). Detection
is by the *live* table's columns — upgraded installs migrate once and fresh
installs skip entirely. Idempotent steps:

1. Backfill `pipelines.template_slug` from the legacy `is_default` + `kind`
   pair, then drop both legacy columns (capability is derived from the
   definition now, never stored).
2. Convert `collections.ingestion_pipeline_id` / `retrieval_pipeline_id`
   into binding rows (`role=ingest`; `role=tool` with `is_primary`), then
   drop the two FK columns.
3. Rewrite `pipeline_runs.kind` (`ingestion`/`retrieval`) into the new
   `trigger` column (`ingest`/`tool`), drop `kind`, and tighten `trigger`
   to NOT NULL (init_db adds it nullable on populated tables).
"""

from __future__ import annotations

import logging

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlmodel import Session

logger = logging.getLogger(__name__)


def _columns(session: Session, table: str) -> set[str]:
    """Return the live column names of a table (empty when absent)."""
    inspector = sa_inspect(session.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _column_nullable(session: Session, table: str, column: str) -> bool:
    """Return whether a live column is nullable."""
    inspector = sa_inspect(session.get_bind())
    for info in inspector.get_columns(table):
        if info["name"] == column:
            return bool(info["nullable"])
    return True


def migrate_pipeline_bindings(session: Session) -> None:
    """Migrate legacy kind/FK-column state onto bindings, once."""
    _migrate_pipeline_columns(session)
    _migrate_collection_columns(session)
    _migrate_run_trigger(session)
    session.commit()


def _migrate_pipeline_columns(session: Session) -> None:
    """Backfill template_slug from is_default+kind, then drop the legacy columns."""
    columns = _columns(session, "pipelines")
    if "kind" not in columns and "is_default" not in columns:
        return
    if "kind" in columns and "is_default" in columns:
        session.execute(
            text(
                "UPDATE pipelines SET template_slug = 'default-ingest' "
                "WHERE is_default IS TRUE AND kind = 'ingestion' AND template_slug IS NULL"
            )
        )
        session.execute(
            text(
                "UPDATE pipelines SET template_slug = 'default-search' "
                "WHERE is_default IS TRUE AND kind = 'retrieval' AND template_slug IS NULL"
            )
        )
    session.execute(text("ALTER TABLE pipelines DROP COLUMN IF EXISTS kind"))
    session.execute(text("ALTER TABLE pipelines DROP COLUMN IF EXISTS is_default"))
    logger.info("Migrated pipelines.kind/is_default onto template_slug.")


def _migrate_collection_columns(session: Session) -> None:
    """Convert the two legacy pipeline FK columns into binding rows."""
    columns = _columns(session, "collections")
    if "ingestion_pipeline_id" not in columns and "retrieval_pipeline_id" not in columns:
        return
    if "ingestion_pipeline_id" in columns:
        session.execute(
            text(
                "INSERT INTO collection_pipeline_bindings "
                "(id, collection_id, pipeline_id, role, is_primary, enabled, position, "
                "created_at, updated_at) "
                "SELECT gen_random_uuid(), c.id, c.ingestion_pipeline_id, 'ingest', "
                "FALSE, TRUE, 0, NOW(), NOW() FROM collections c "
                "WHERE c.ingestion_pipeline_id IS NOT NULL AND NOT EXISTS ("
                "SELECT 1 FROM collection_pipeline_bindings b "
                "WHERE b.collection_id = c.id AND b.role = 'ingest')"
            )
        )
    if "retrieval_pipeline_id" in columns:
        session.execute(
            text(
                "INSERT INTO collection_pipeline_bindings "
                "(id, collection_id, pipeline_id, role, is_primary, enabled, position, "
                "created_at, updated_at) "
                "SELECT gen_random_uuid(), c.id, c.retrieval_pipeline_id, 'tool', "
                "TRUE, TRUE, 0, NOW(), NOW() FROM collections c "
                "WHERE c.retrieval_pipeline_id IS NOT NULL AND NOT EXISTS ("
                "SELECT 1 FROM collection_pipeline_bindings b "
                "WHERE b.collection_id = c.id AND b.role = 'tool')"
            )
        )
    session.execute(text("ALTER TABLE collections DROP COLUMN IF EXISTS ingestion_pipeline_id"))
    session.execute(text("ALTER TABLE collections DROP COLUMN IF EXISTS retrieval_pipeline_id"))
    logger.info("Migrated collection pipeline FK columns onto bindings.")


def _migrate_run_trigger(session: Session) -> None:
    """Rewrite pipeline_runs.kind into trigger and tighten it to NOT NULL."""
    columns = _columns(session, "pipeline_runs")
    if "trigger" not in columns:
        return
    if "kind" in columns:
        session.execute(
            text(
                "UPDATE pipeline_runs SET trigger = "
                "CASE WHEN kind = 'ingestion' THEN 'ingest' ELSE 'tool' END "
                "WHERE trigger IS NULL"
            )
        )
        session.execute(text("ALTER TABLE pipeline_runs DROP COLUMN kind"))
        logger.info("Migrated pipeline_runs.kind onto trigger.")
    if _column_nullable(session, "pipeline_runs", "trigger"):
        session.execute(text("UPDATE pipeline_runs SET trigger = 'tool' WHERE trigger IS NULL"))
        session.execute(text("ALTER TABLE pipeline_runs ALTER COLUMN trigger SET NOT NULL"))
