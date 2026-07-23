"""The legacy-columns → bindings startup migration, exercised on real Postgres.

Recreates the pre-bindings schema shape (the two collection FK columns,
pipelines.kind/is_default, pipeline_runs.kind) with raw DDL, seeds
legacy-shaped rows, runs `migrate_pipeline_bindings`, and asserts the rows
landed in the new shape and the legacy columns are gone. Idempotence is
asserted by running the migration twice.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlmodel import Session, select

from app.db import models
from app.services.binding_migration import migrate_pipeline_bindings


def _seed_legacy_state(session: Session) -> tuple[models.User, models.Collection, dict[str, models.Pipeline]]:
    """Recreate the pre-migration schema and one legacy-shaped install."""
    user = models.User(email="legacy@example.com", full_name="Legacy", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)

    pipelines: dict[str, models.Pipeline] = {}
    for slot in ("ingestion", "retrieval"):
        pipeline = models.Pipeline(user_id=user.id, name=f"Default {slot}")
        session.add(pipeline)
        pipelines[slot] = pipeline
    collection = models.Collection(
        user_id=user.id, name="Legacy Docs", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    for pipeline in pipelines.values():
        session.refresh(pipeline)
    session.refresh(collection)

    run = models.PipelineRun(
        pipeline_id=pipelines["ingestion"].id,
        trigger=models.BindingRole.INGEST,  # placeholder; rewritten below
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
    )
    session.add(run)
    session.commit()

    # Reintroduce the legacy columns and values the migration must consume.
    session.execute(text("ALTER TABLE pipelines ADD COLUMN kind VARCHAR"))
    session.execute(text("ALTER TABLE pipelines ADD COLUMN is_default BOOLEAN DEFAULT FALSE"))
    session.execute(text("ALTER TABLE collections ADD COLUMN ingestion_pipeline_id UUID"))
    session.execute(text("ALTER TABLE collections ADD COLUMN retrieval_pipeline_id UUID"))
    session.execute(text("ALTER TABLE pipeline_runs ADD COLUMN kind VARCHAR"))
    # On real upgrades init_db adds `trigger` nullable (populated table, no
    # default); recreate that intermediate state so the migration must both
    # backfill and tighten it.
    session.execute(text("ALTER TABLE pipeline_runs ALTER COLUMN trigger DROP NOT NULL"))
    session.execute(
        text("UPDATE pipelines SET kind = :kind, is_default = TRUE, template_slug = NULL WHERE id = :id"),
        {"kind": "ingestion", "id": pipelines["ingestion"].id},
    )
    session.execute(
        text("UPDATE pipelines SET kind = :kind, is_default = TRUE, template_slug = NULL WHERE id = :id"),
        {"kind": "retrieval", "id": pipelines["retrieval"].id},
    )
    session.execute(
        text(
            "UPDATE collections SET ingestion_pipeline_id = :ingest, "
            "retrieval_pipeline_id = :tool WHERE id = :id"
        ),
        {
            "ingest": pipelines["ingestion"].id,
            "tool": pipelines["retrieval"].id,
            "id": collection.id,
        },
    )
    session.execute(
        text("UPDATE pipeline_runs SET kind = 'ingestion', trigger = NULL WHERE id = :id"),
        {"id": run.id},
    )
    session.execute(text("DELETE FROM collection_pipeline_bindings"))
    session.commit()
    return user, collection, pipelines


def test_migration_converts_legacy_columns_into_bindings(session: Session) -> None:
    _, collection, pipelines = _seed_legacy_state(session)

    migrate_pipeline_bindings(session)

    bindings = session.exec(
        select(models.CollectionPipelineBinding).where(
            models.CollectionPipelineBinding.collection_id == collection.id
        )
    ).all()
    by_role = {models.BindingRole(binding.role).value: binding for binding in bindings}
    assert set(by_role) == {"ingest", "tool"}
    assert by_role["ingest"].pipeline_id == pipelines["ingestion"].id
    assert by_role["tool"].pipeline_id == pipelines["retrieval"].id
    assert by_role["tool"].is_primary is True

    refreshed = {
        pipeline.id: pipeline for pipeline in session.exec(select(models.Pipeline)).all()
    }
    assert refreshed[pipelines["ingestion"].id].template_slug == "default-ingest"
    assert refreshed[pipelines["retrieval"].id].template_slug == "default-search"

    run = session.exec(select(models.PipelineRun)).one()
    assert models.BindingRole(run.trigger) == models.BindingRole.INGEST

    inspector = sa_inspect(session.get_bind())
    collection_columns = {c["name"] for c in inspector.get_columns("collections")}
    pipeline_columns = {c["name"] for c in inspector.get_columns("pipelines")}
    run_columns = {c["name"] for c in inspector.get_columns("pipeline_runs")}
    assert "ingestion_pipeline_id" not in collection_columns
    assert "retrieval_pipeline_id" not in collection_columns
    assert "kind" not in pipeline_columns
    assert "is_default" not in pipeline_columns
    assert "kind" not in run_columns


def test_migration_is_idempotent_and_skips_fresh_installs(session: Session) -> None:
    user, collection, _ = _seed_legacy_state(session)

    migrate_pipeline_bindings(session)
    migrate_pipeline_bindings(session)  # second run must be a no-op

    bindings = session.exec(
        select(models.CollectionPipelineBinding).where(
            models.CollectionPipelineBinding.collection_id == collection.id
        )
    ).all()
    assert len(bindings) == 2

    # A fresh collection (no legacy columns anywhere) is untouched.
    fresh = models.Collection(
        user_id=user.id, name="Fresh", description="", extra_metadata={}
    )
    session.add(fresh)
    session.commit()
    migrate_pipeline_bindings(session)
    fresh_bindings = session.exec(
        select(models.CollectionPipelineBinding).where(
            models.CollectionPipelineBinding.collection_id == fresh.id
        )
    ).all()
    assert fresh_bindings == []
