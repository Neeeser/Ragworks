"""Collapsing per-collection index slots back into the graph.

The invariant every assertion defends: after the migration each binding still
resolves to exactly the index it resolved to before. A collapse that lets a
collection quietly fall back to the definition's default detaches its corpus
from its data, and nothing downstream reports it — retrieval just returns
nothing.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlmodel import Session, select

from app.db import models
from app.services.slot_collapse_migration import collapse_index_slots

BINDINGS = "collection_pipeline_bindings"


def _slotted_definition(default_index: str) -> dict[str, Any]:
    """A stored v3 definition whose indexer reads a binding-source slot."""
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
                    "name": default_index,
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


def _user(session: Session, email: str = "collapse@example.com") -> models.User:
    user = models.User(email=email, full_name="Collapse", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _collection(session: Session, user: models.User, name: str) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name=name, description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _pipeline(
    session: Session, user: models.User, definition: dict[str, Any]
) -> models.Pipeline:
    pipeline = models.Pipeline(user_id=user.id, name="Slotted")
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    session.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id, version=1, definition=definition
        )
    )
    session.commit()
    return pipeline


def _ensure_values_column(session: Session) -> None:
    """Recreate the dropped overrides column so a legacy row can be written."""
    session.exec(  # type: ignore[call-overload]
        text(f"ALTER TABLE {BINDINGS} ADD COLUMN IF NOT EXISTS variable_values JSON")
    )
    session.commit()


def _bind(
    session: Session,
    collection: models.Collection,
    pipeline: models.Pipeline,
    overrides: dict[str, Any] | None = None,
) -> UUID:
    """Create a binding carrying legacy `variable_values`."""
    binding = models.CollectionPipelineBinding(
        collection_id=collection.id,
        pipeline_id=pipeline.id,
        role=models.BindingRole.INGEST,
    )
    session.add(binding)
    session.commit()
    session.refresh(binding)
    session.exec(  # type: ignore[call-overload]
        text(
            f"UPDATE {BINDINGS} SET variable_values = CAST(:values AS json) "
            "WHERE id = CAST(:id AS uuid)"
        ).bindparams(values=json.dumps(overrides or {}), id=str(binding.id))
    )
    session.commit()
    return binding.id


def _definition_of(session: Session, pipeline_id: UUID) -> dict[str, Any]:
    version = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline_id
        )
    ).one()
    assert isinstance(version.definition, dict)
    return version.definition


def _index_name(definition: dict[str, Any]) -> Any:
    return definition["nodes"][0]["config"]["index_name"]


def test_a_slot_every_binding_agrees_on_collapses_to_a_literal(
    session: Session,
) -> None:
    user = _user(session)
    collection = _collection(session, user, "Only")
    pipeline = _pipeline(session, user, _slotted_definition("ragworks"))
    _ensure_values_column(session)
    _bind(session, collection, pipeline)

    collapse_index_slots(session)

    definition = _definition_of(session, pipeline.id)
    assert _index_name(definition) == "ragworks"
    assert definition["variables"] == []
    # The namespace expression is untouched — only slot references collapse.
    assert definition["nodes"][0]["config"]["namespace"] == {
        "$expr": "'col-' + collection_id"
    }


def test_a_divergent_binding_is_repointed_at_a_copy(session: Session) -> None:
    """The collection that chose differently keeps the index it chose.

    Collapsing to the default would move its reads and writes to another
    store with nothing at query time to say so.
    """
    user = _user(session)
    first = _collection(session, user, "First")
    second = _collection(session, user, "Second")
    pipeline = _pipeline(session, user, _slotted_definition("ragworks"))
    _ensure_values_column(session)
    _bind(session, first, pipeline)
    divergent = _bind(
        session,
        second,
        pipeline,
        {
            "primary_index": {
                "index_id": str(uuid4()),
                "backend": "pgvector",
                "name": "second-index",
            }
        },
    )

    collapse_index_slots(session)

    with Session(session.get_bind()) as fresh:
        moved = fresh.get(models.CollectionPipelineBinding, divergent)
        assert moved is not None
        assert moved.pipeline_id != pipeline.id
        copy = fresh.get(models.Pipeline, moved.pipeline_id)
        assert copy is not None
        assert copy.name == "Slotted (copy)"
        assert _index_name(_definition_of(fresh, copy.id)) == "second-index"
        # ...and the original still serves the collection that never diverged.
        assert _index_name(_definition_of(fresh, pipeline.id)) == "ragworks"


def test_the_overrides_column_is_dropped(session: Session) -> None:
    """A NOT NULL column the model stopped populating rejects every insert."""
    user = _user(session)
    collection = _collection(session, user, "Only")
    pipeline = _pipeline(session, user, _slotted_definition("ragworks"))
    _ensure_values_column(session)
    _bind(session, collection, pipeline)

    collapse_index_slots(session)

    with Session(session.get_bind()) as fresh:
        columns = fresh.exec(  # type: ignore[call-overload]
            text(
                "SELECT column_name FROM information_schema.columns "
                f"WHERE table_name = '{BINDINGS}'"
            )
        )
        assert "variable_values" not in {row[0] for row in columns}


def test_definitions_without_slots_are_left_alone(session: Session) -> None:
    user = _user(session)
    literal = {
        "schema_version": 3,
        "name": "Literal",
        "variables": [],
        "nodes": [
            {
                "id": "index-chunks",
                "type": "indexer.vector",
                "name": "Indexer",
                "config": {"backend": "pgvector", "index_name": "ragworks"},
            }
        ],
        "edges": [],
    }
    pipeline = _pipeline(session, user, literal)

    assert collapse_index_slots(session) == 0
    assert _definition_of(session, pipeline.id) == literal


def test_a_second_boot_is_a_no_op(session: Session) -> None:
    """The migration runs on every startup; the second one must find nothing."""
    user = _user(session)
    collection = _collection(session, user, "Only")
    pipeline = _pipeline(session, user, _slotted_definition("ragworks"))
    _ensure_values_column(session)
    _bind(session, collection, pipeline)

    first = collapse_index_slots(session)
    second = collapse_index_slots(session)

    assert first == 1
    assert second == 0
    assert _index_name(_definition_of(session, pipeline.id)) == "ragworks"


def test_a_malformed_stored_definition_is_skipped(session: Session) -> None:
    """A row that is not a definition object must not stop the boot."""
    user = _user(session)
    pipeline = models.Pipeline(user_id=user.id, name="Broken")
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    session.add(
        models.PipelineVersion(pipeline_id=pipeline.id, version=1, definition=[])
    )
    session.commit()

    assert collapse_index_slots(session) == 0


def test_a_definition_whose_variables_are_not_a_list_is_skipped(
    session: Session,
) -> None:
    """Only the shape the old migration wrote is collapsed, nothing else."""
    user = _user(session)
    pipeline = models.Pipeline(user_id=user.id, name="Odd")
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    session.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition={"schema_version": 3, "variables": {}, "nodes": [], "edges": []},
        )
    )
    session.commit()

    assert collapse_index_slots(session) == 0


def test_a_node_config_expression_over_an_unknown_name_is_left_alone(
    session: Session,
) -> None:
    """Only the slots being removed are collapsed.

    A config expression over a panel variable or an input argument is
    ordinary authored behavior; rewriting it to a literal would freeze a
    value the pipeline is supposed to compute per run.
    """
    user = _user(session)
    collection = _collection(session, user, "Only")
    definition = _slotted_definition("ragworks")
    definition["nodes"].append(
        {
            "id": "retrieve",
            "type": "retriever.vector",
            "name": "Retriever",
            "config": {
                "backend": "pgvector",
                "index_name": "ragworks",
                "top_k": {"$expr": "result_limit * 2"},
            },
        }
    )
    pipeline = _pipeline(session, user, definition)
    _ensure_values_column(session)
    _bind(session, collection, pipeline)

    assert collapse_index_slots(session) == 1

    collapsed = _definition_of(session, pipeline.id)
    retriever = next(node for node in collapsed["nodes"] if node["id"] == "retrieve")
    assert retriever["config"]["top_k"] == {"$expr": "result_limit * 2"}
