"""Behavior of ``CollectionService`` (create, update, prompt rendering).

Migrated from ``tests/api/test_collections_routes.py`` when Task 6.2 moved the
behavior off the route into the service; the route now only shapes the response
and translates the domain errors these tests raise.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository, UserRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.schemas.collections import (
    CollectionCreate,
    CollectionPipelineOverrides,
    CollectionUpdate,
    PipelineNodeOverride,
)
from app.services.collections import CollectionService
from app.services.errors import InvalidInputError
from app.services.pipelines import PipelineService
from app.services.prompts import SYSTEM_PROMPT_METADATA_KEY


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        extra_metadata={},
    )
    CollectionRepository(session).add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_create_assigns_default_pipelines(session: Session) -> None:
    user = _create_user(session)

    created = CollectionService(session).create(
        user, CollectionCreate(name="Unit Collection", description="Test")
    )

    assert created.ingestion_pipeline_id is not None
    assert created.retrieval_pipeline_id is not None


def test_create_with_pipeline_overrides_clones_both(session: Session) -> None:
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    session.commit()

    ingestion_definition = pipeline_service.get_definition(defaults.ingestion)
    retrieval_definition = pipeline_service.get_definition(defaults.retrieval)
    chunker = next(n for n in ingestion_definition.nodes if n.type == "chunker.token")
    retriever = next(n for n in retrieval_definition.nodes if n.type == "retriever.vector")

    created = CollectionService(session).create(
        user,
        CollectionCreate(
            name="Overrides Collection",
            pipeline_overrides=CollectionPipelineOverrides(
                ingestion=[PipelineNodeOverride(node_id=chunker.id, config={"chunk_size": 2048})],
                retrieval=[
                    PipelineNodeOverride(node_id=retriever.id, config={"namespace": "custom-ns"})
                ],
            ),
        ),
    )

    assert created.ingestion_pipeline_id != defaults.ingestion.id
    assert created.retrieval_pipeline_id != defaults.retrieval.id

    ingestion_pipeline = pipeline_service.get_pipeline(created.ingestion_pipeline_id, user.id)
    retrieval_pipeline = pipeline_service.get_pipeline(created.retrieval_pipeline_id, user.id)
    assert ingestion_pipeline is not None
    assert retrieval_pipeline is not None
    updated_chunker = next(
        n for n in pipeline_service.get_definition(ingestion_pipeline).nodes
        if n.type == "chunker.token"
    )
    updated_retriever = next(
        n for n in pipeline_service.get_definition(retrieval_pipeline).nodes
        if n.type == "retriever.vector"
    )
    # Merged, not replaced: the untouched sibling field survives the override.
    assert updated_chunker.config["chunk_size"] == 2048
    assert updated_chunker.config["chunk_overlap"] == 200
    assert updated_retriever.config["namespace"] == "custom-ns"
    assert updated_retriever.config["backend"] == "pgvector"


def test_create_with_ingestion_overrides_only(session: Session) -> None:
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    session.commit()
    chunker = next(
        n for n in pipeline_service.get_definition(defaults.ingestion).nodes
        if n.type == "chunker.token"
    )

    created = CollectionService(session).create(
        user,
        CollectionCreate(
            name="Overrides",
            pipeline_overrides=CollectionPipelineOverrides(
                ingestion=[PipelineNodeOverride(node_id=chunker.id, config={"chunk_size": 2048})],
            ),
        ),
    )

    assert created.ingestion_pipeline_id != defaults.ingestion.id
    assert created.retrieval_pipeline_id == defaults.retrieval.id


def test_create_with_retrieval_overrides_only(session: Session) -> None:
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    session.commit()
    retriever = next(
        n for n in pipeline_service.get_definition(defaults.retrieval).nodes
        if n.type == "retriever.vector"
    )

    created = CollectionService(session).create(
        user,
        CollectionCreate(
            name="Overrides",
            pipeline_overrides=CollectionPipelineOverrides(
                retrieval=[
                    PipelineNodeOverride(node_id=retriever.id, config={"namespace": "custom-ns"})
                ],
            ),
        ),
    )

    assert created.retrieval_pipeline_id != defaults.retrieval.id
    assert created.ingestion_pipeline_id == defaults.ingestion.id


def test_create_rejects_invalid_pipeline_kind(session: Session) -> None:
    user = _create_user(session)
    retrieval_pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Retrieval",
        kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()

    with pytest.raises(InvalidInputError):
        CollectionService(session).create(
            user, CollectionCreate(name="Invalid", ingestion_pipeline_id=retrieval_pipeline.id)
        )


def test_update_updates_fields(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    updated = CollectionService(session).update(
        collection,
        CollectionUpdate(name="Updated", description="Updated desc", metadata={"owner": "unit"}),
        user,
    )

    assert updated.name == "Updated"
    assert updated.extra_metadata["owner"] == "unit"


def test_update_assigns_pipeline_ids(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline_service = PipelineService(session)
    ingestion_pipeline = pipeline_service.create_pipeline(
        user=user, name="Ingestion", kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    retrieval_pipeline = pipeline_service.create_pipeline(
        user=user, name="Retrieval", kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()

    updated = CollectionService(session).update(
        collection,
        CollectionUpdate(
            ingestion_pipeline_id=ingestion_pipeline.id,
            retrieval_pipeline_id=retrieval_pipeline.id,
        ),
        user,
    )

    assert updated.ingestion_pipeline_id == ingestion_pipeline.id
    assert updated.retrieval_pipeline_id == retrieval_pipeline.id


def test_update_rejects_invalid_pipeline_kind(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    retrieval_pipeline = PipelineService(session).create_pipeline(
        user=user, name="Retrieval", kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()

    with pytest.raises(InvalidInputError):
        CollectionService(session).update(
            collection,
            CollectionUpdate(ingestion_pipeline_id=retrieval_pipeline.id),
            user,
        )


def test_prompt_read_returns_template(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    prompt = CollectionService(session).prompt_read(collection, user)

    assert prompt.template
    assert prompt.rendered


def test_prompt_read_rejects_unresolvable_pipeline(monkeypatch, session: Session) -> None:
    class _StubPipelineService:
        def __init__(self, _session) -> None:
            pass

        def ensure_default_pipelines(self, _user):
            return SimpleNamespace(
                ingestion=SimpleNamespace(id=uuid4()),
                retrieval=SimpleNamespace(id=uuid4()),
            )

        def ensure_collection_pipelines(self, *_args, **_kwargs):
            return None

        def get_pipeline(self, _pipeline_id, _user_id):
            return None

    # Resolution constructs its own PipelineService inside pipeline_resolution;
    # that is the boundary to stub, not CollectionService's own reference.
    monkeypatch.setattr("app.services.pipeline_resolution.PipelineService", _StubPipelineService)

    with pytest.raises(InvalidInputError):
        CollectionService(session).prompt_read(
            SimpleNamespace(ingestion_pipeline_id=None, retrieval_pipeline_id=None),
            SimpleNamespace(id=uuid4()),
        )


def test_update_prompt_persists_and_clears_template(session: Session) -> None:
    """Prompt updates must survive to the database, not just the request session.

    Regression coverage: the JSON ``extra_metadata`` column is reassigned (never
    mutated in place) so SQLAlchemy tracks the change. Every persistence
    assertion reads through a FRESH session so it can't pass via object identity.
    """
    user = _create_user(session)
    collection = _create_collection(session, user)
    original_updated_at = collection.updated_at
    service = CollectionService(session)

    updated = service.update_prompt(collection, user, "Hello {{collection.name}}")
    assert updated.template
    assert updated.rendered

    with Session(session.get_bind()) as fresh:
        persisted = fresh.get(models.Collection, collection.id)
        assert persisted is not None
        assert persisted.extra_metadata.get(SYSTEM_PROMPT_METADATA_KEY) == "Hello {{collection.name}}"
        assert persisted.updated_at > original_updated_at

    cleared = service.update_prompt(collection, user, "  ")
    assert "Tool context" in cleared.rendered

    with Session(session.get_bind()) as fresh:
        persisted = fresh.get(models.Collection, collection.id)
        assert persisted is not None
        assert SYSTEM_PROMPT_METADATA_KEY not in persisted.extra_metadata
