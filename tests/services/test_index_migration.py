"""The definitions v2 -> v3 migration onto first-class index entities.

The invariant every assertion here defends: a migrated pipeline resolves to
exactly the index targets it resolved to before. A migration that changes
which index a collection reads silently detaches a corpus from its data, and
nothing downstream would report it — retrieval simply returns nothing.
"""

from __future__ import annotations

from uuid import uuid4

from sqlmodel import Session, select

from app.db import models
from app.db.repositories import RegisteredIndexRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import PipelineDefinition
from app.pipelines.registry import default_registry
from app.pipelines.settings import resolve_pipeline_settings
from app.pipelines.variables import VariableType
from app.schemas.enums import IndexBackend
from app.services.index_migration import migrate_index_entities


def _legacy_definition(definition: PipelineDefinition) -> dict[str, object]:
    """Dump a definition as a pre-v3 stored row (no schema_version bump)."""
    raw = definition.model_dump(mode="json")
    raw["schema_version"] = 2
    return raw


def _seed_pipeline(
    session: Session,
    user: models.User,
    definition: PipelineDefinition,
    name: str = "Legacy",
) -> models.Pipeline:
    """Persist a pipeline whose current version holds a pre-v3 definition."""
    pipeline = models.Pipeline(user_id=user.id, name=name)
    session.add(pipeline)
    session.commit()
    session.refresh(pipeline)
    version = models.PipelineVersion(
        pipeline_id=pipeline.id,
        version=1,
        definition=_legacy_definition(definition),
    )
    session.add(version)
    session.commit()
    session.refresh(pipeline)
    return pipeline


def _user(session: Session, email: str = "migrate@example.com") -> models.User:
    user = models.User(email=email, full_name="Migrate", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Docs", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _ingestion_definition() -> PipelineDefinition:
    return build_default_ingestion_pipeline(
        embedding_connection_id=uuid4(),
        embedding_model="text-embedding-3-small",
        backend=IndexBackend.PGVECTOR,
        index_name="docs-main",
    )


def _current_definition(session: Session, pipeline: models.Pipeline) -> PipelineDefinition:
    """Read back the pipeline's current stored version through a fresh query."""
    version = session.exec(
        select(models.PipelineVersion)
        .where(models.PipelineVersion.pipeline_id == pipeline.id)
        .where(models.PipelineVersion.version == pipeline.current_version)
    ).one()
    return PipelineDefinition.model_validate(version.definition)


def test_migration_preserves_every_resolved_index_target(session: Session) -> None:
    """The property the whole design rests on: same targets before and after."""
    user = _user(session)
    collection = _collection(session, user)
    definition = _ingestion_definition()
    pipeline = _seed_pipeline(session, user, definition)
    before = resolve_pipeline_settings(definition, collection, default_registry())

    migrate_index_entities(session)

    after = resolve_pipeline_settings(
        _current_definition(session, pipeline), collection, default_registry()
    )
    assert after.index_targets == before.index_targets
    assert after.namespace == before.namespace
    assert after.backend == before.backend
    assert after.index_name == before.index_name


def test_migration_leaves_the_index_named_in_the_graph(session: Session) -> None:
    """Registering an index makes it selectable; it never hoists the choice.

    A migration that turns every store node into a collection-filled slot
    hands every existing pipeline a decision its author never exposed, and
    puts it on a page that should be about the corpus.
    """
    user = _user(session)
    pipeline = _seed_pipeline(session, user, _ingestion_definition())

    migrate_index_entities(session)

    migrated = _current_definition(session, pipeline)
    assert [
        variable for variable in migrated.variables if variable.type is VariableType.INDEX
    ] == []
    indexer = next(node for node in migrated.nodes if node.type.startswith("indexer."))
    assert indexer.config["index_name"] == "docs-main"


def test_two_dense_stores_survive_the_migration(session: Session) -> None:
    """A pipeline splitting its corpus keeps both indexes.

    Folding every dense node onto one shared slot merges two corpora into
    whichever name is read last. Nothing downstream reports it: the run
    succeeds and retrieval returns the wrong chunks.
    """
    user = _user(session)
    collection = _collection(session, user)
    definition = _ingestion_definition()
    second = next(
        node for node in definition.nodes if node.type.startswith("indexer.")
    ).model_copy(
        update={
            "id": "indexer-facts",
            "name": "Facts",
            "config": {
                **next(
                    node for node in definition.nodes if node.type.startswith("indexer.")
                ).config,
                "index_name": "docs-facts",
            },
        }
    )
    split = definition.model_copy(update={"nodes": [*definition.nodes, second]})
    pipeline = _seed_pipeline(session, user, split)
    before = resolve_pipeline_settings(split, collection, default_registry())

    migrate_index_entities(session)

    after = resolve_pipeline_settings(
        _current_definition(session, pipeline), collection, default_registry()
    )
    names = {target.index_name for target in after.index_targets}
    assert {"docs-main", "docs-facts"} <= names
    assert after.index_targets == before.index_targets


def test_migration_registers_one_index_row_per_identity(session: Session) -> None:
    user = _user(session)
    _seed_pipeline(session, user, _ingestion_definition())

    migrate_index_entities(session)

    rows = session.exec(select(models.RegisteredIndex)).all()
    dense = [row for row in rows if row.vector_type == "dense"]
    assert [row.name for row in dense] == ["docs-main"]
    assert dense[0].backend == IndexBackend.PGVECTOR
    assert dense[0].user_id == user.id


def test_two_pipelines_naming_one_index_share_a_row(session: Session) -> None:
    """Sharing is the point of the entity — it answers 'who uses this?'."""
    user = _user(session)
    _seed_pipeline(session, user, _ingestion_definition(), name="Ingest")
    retrieval = build_default_retrieval_pipeline(
        embedding_connection_id=uuid4(),
        embedding_model="text-embedding-3-small",
        backend=IndexBackend.PGVECTOR,
        index_name="docs-main",
    )
    _seed_pipeline(session, user, retrieval, name="Retrieve")

    migrate_index_entities(session)

    rows = RegisteredIndexRepository(session).list_for_user(user.id)
    dense = [row for row in rows if row.vector_type == "dense"]
    assert len(dense) == 1


def test_migration_is_idempotent(session: Session) -> None:
    """A repointed binding must not be undone by the next boot."""
    user = _user(session)
    pipeline = _seed_pipeline(session, user, _ingestion_definition())

    first = migrate_index_entities(session)
    after_first = _current_definition(session, pipeline).model_dump(mode="json")
    second = migrate_index_entities(session)

    assert first == 1
    assert second == 0
    assert _current_definition(session, pipeline).model_dump(mode="json") == after_first


def test_namespace_template_becomes_a_checked_expression(session: Session) -> None:
    """`col-{collection_id}` resolves identically through the expression path."""
    user = _user(session)
    collection = _collection(session, user)
    definition = _ingestion_definition()
    pipeline = _seed_pipeline(session, user, definition)
    before = resolve_pipeline_settings(definition, collection, default_registry())

    migrate_index_entities(session)

    migrated = _current_definition(session, pipeline)
    indexer = next(
        node for node in migrated.nodes if node.type.startswith("indexer.")
    )
    assert isinstance(indexer.config["namespace"], dict)
    after = resolve_pipeline_settings(migrated, collection, default_registry())
    assert after.namespace == before.namespace
    assert after.namespace == f"col-{collection.id}"
