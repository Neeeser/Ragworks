"""The startup migration sequence against a database still on an old shape.

The ordering is the contract: a stored definition can hold a shape the current
schema refuses to parse, and only the migration that rewrites it can be allowed
to run before the ones that parse. Get that backwards and the process dies in
`lifespan` — the app never serves, and no amount of retrying fixes it, because
the row that breaks startup is the row the skipped migration would have fixed.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlmodel import Session, select

from app.db import models
from app.services.startup_migrations import run_startup_migrations

BINDINGS = "collection_pipeline_bindings"


def _binding_source_definition(index_name: str) -> dict[str, Any]:
    """A stored definition whose indexer reads a binding-source index slot.

    `source: "binding"` is no longer a valid `VariableSource`, which is exactly
    what makes this row the one that breaks a parse-first startup.
    """
    return {
        "schema_version": 3,
        "name": "Slotted",
        "variables": [
            {
                "name": "primary_index",
                "type": "index",
                "source": "binding",
                "description": "Vector index this pipeline uses",
                "value": {
                    "index_id": str(uuid4()),
                    "backend": "pgvector",
                    "name": index_name,
                },
            }
        ],
        "nodes": [
            {
                "id": "index-chunks",
                "type": "indexer.vector",
                "name": "Indexer",
                "config": {
                    "backend": {"$expr": "primary_index.backend"},
                    "index_name": {"$expr": "primary_index.name"},
                    "namespace": {"$expr": "'col-' + collection_id"},
                },
            }
        ],
        "edges": [],
    }


def _seed_legacy_pipeline(session: Session, index_name: str) -> models.Pipeline:
    """A user, collection, and pipeline bound the pre-collapse way."""
    user = models.User(
        email=f"startup-{uuid4().hex[:8]}@example.com",
        full_name="Startup",
        hashed_password="x",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    collection = models.Collection(
        user_id=user.id, name="Legacy", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)

    pipeline = models.Pipeline(user_id=user.id, name="Slotted")
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    session.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition=_binding_source_definition(index_name),
        )
    )

    binding = models.CollectionPipelineBinding(
        collection_id=collection.id,
        pipeline_id=pipeline.id,
        role=models.BindingRole.INGEST,
    )
    session.add(binding)
    session.commit()
    session.refresh(binding)

    # The overrides column the old shape answered its slots from.
    session.exec(  # type: ignore[call-overload]
        text(f"ALTER TABLE {BINDINGS} ADD COLUMN IF NOT EXISTS variable_values JSON")
    )
    session.exec(  # type: ignore[call-overload]
        text(
            f"UPDATE {BINDINGS} SET variable_values = CAST(:values AS json) "
            "WHERE id = CAST(:id AS uuid)"
        ).bindparams(values=json.dumps({}), id=str(binding.id))
    )
    session.commit()
    return pipeline


def test_startup_migrates_a_definition_the_schema_can_no_longer_parse(
    session: Session,
) -> None:
    """Startup collapses the old slot shape instead of dying while parsing it."""
    pipeline = _seed_legacy_pipeline(session, "legacy-index")

    run_startup_migrations(session)

    version = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline.id
        )
    ).one()
    variables = version.definition["variables"]
    assert all(variable["source"] != "binding" for variable in variables), (
        "the binding-source slot survived startup"
    )
    # The index the binding resolved to is still the one the graph names.
    assert "legacy-index" in json.dumps(version.definition)
