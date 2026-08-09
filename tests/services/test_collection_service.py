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
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    CollectionRepository,
    UserRepository,
)
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.schemas.collections import CollectionCreate, CollectionUpdate
from app.services.collections import CollectionService
from app.services.errors import InvalidInputError
from app.services.pipelines import PipelineService
from tests.utils.collections import bind_scaffolds, collection_create
from tests.utils.pipelines import with_tool_name
from tests.utils.providers import TEST_EMBED_CONNECTION_ID, install_scaffolded_pipelines


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_scaffolded_pipelines(session, user)
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
    return bind_scaffolds(session, user, collection)


def _bound_ids(session: Session, collection: models.Collection) -> dict[str, object]:
    """Return the collection's bound pipeline ids keyed by role value."""

    bindings = CollectionPipelineBindingRepository(session).list_for_collection(
        collection.id
    )
    return {
        models.BindingRole(binding.role).value: binding.pipeline_id
        for binding in bindings
    }


def test_create_assigns_default_pipelines(session: Session) -> None:
    user = _create_user(session)

    created = CollectionService(session).create(
        user, collection_create(session, user, "Unit Collection", "Test")
    )

    bound = _bound_ids(session, created)
    assert set(bound) == {"ingest", "tool"}


def test_create_binds_tool_pipelines_in_order_with_the_first_primary(session: Session) -> None:
    """Extra tool pipelines bind alongside the primary one, in the given order."""
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = install_scaffolded_pipelines(session, user)
    second = pipeline_service.create_pipeline(
        user=user,
        name="Second Tool",
        definition=with_tool_name(
            build_default_retrieval_pipeline(
                embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
            ),
            "second_tool",
        ),
    )
    session.commit()

    created = CollectionService(session).create(
        user,
        CollectionCreate(
            name="Multi-tool",
            ingest_pipeline_id=defaults.ingestion.id,
            tool_pipeline_ids=[defaults.retrieval.id, second.id],
        ),
    )

    tools = [
        binding
        for binding in CollectionPipelineBindingRepository(session).list_for_collection(
            created.id
        )
        if models.BindingRole(binding.role) == models.BindingRole.TOOL
    ]
    tools.sort(key=lambda binding: binding.position)
    assert [binding.pipeline_id for binding in tools] == [defaults.retrieval.id, second.id]
    assert [binding.is_primary for binding in tools] == [True, False]


def test_create_rejects_invalid_pipeline_kind(session: Session) -> None:
    user = _create_user(session)
    defaults = install_scaffolded_pipelines(session, user)
    retrieval_pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Retrieval",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()

    with pytest.raises(InvalidInputError):
        CollectionService(session).create(
            user,
            CollectionCreate(
                name="Invalid",
                ingest_pipeline_id=retrieval_pipeline.id,
                tool_pipeline_ids=[defaults.retrieval.id],
            ),
        )


def test_create_rejects_two_same_named_tool_pipelines(session: Session) -> None:
    """Two tool pipelines selected together in the wizard that both default to
    (or both declare) the same tool name must be refused, naming both -- and
    must leave no partial collection behind."""
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = install_scaffolded_pipelines(session, user)
    colliding = pipeline_service.create_pipeline(
        user=user,
        name="Colliding Tool",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()

    with pytest.raises(InvalidInputError) as exc_info:
        CollectionService(session).create(
            user,
            CollectionCreate(
                name="Should Not Exist",
                ingest_pipeline_id=defaults.ingestion.id,
                tool_pipeline_ids=[defaults.retrieval.id, colliding.id],
            ),
        )

    message = str(exc_info.value)
    assert defaults.retrieval.name in message
    assert "Colliding Tool" in message
    names = {
        collection.name for collection in CollectionRepository(session).list_for_user(user.id)
    }
    assert "Should Not Exist" not in names


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


def test_update_assigns_ingest_pipeline(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline_service = PipelineService(session)
    ingestion_pipeline = pipeline_service.create_pipeline(
        user=user, name="Ingestion",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()

    updated = CollectionService(session).update(
        collection,
        CollectionUpdate(ingest_pipeline_id=ingestion_pipeline.id),
        user,
    )

    assert _bound_ids(session, updated)["ingest"] == ingestion_pipeline.id


def test_update_rejects_invalid_pipeline_kind(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    retrieval_pipeline = PipelineService(session).create_pipeline(
        user=user, name="Retrieval",
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()

    with pytest.raises(InvalidInputError):
        CollectionService(session).update(
            collection,
            CollectionUpdate(ingest_pipeline_id=retrieval_pipeline.id),
            user,
        )


def test_prompt_read_returns_template(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    prompt = CollectionService(session).prompt_read(collection, user)

    assert prompt.body
    assert prompt.rendered


def test_prompt_read_rejects_unresolvable_pipeline(monkeypatch, session: Session) -> None:
    class _StubPipelineService:
        def __init__(self, _session) -> None:
            pass

        def get_pipeline(self, _pipeline_id, _user_id):
            return None

    # Resolution constructs its own PipelineService inside pipeline_resolution;
    # that is the boundary to stub, not CollectionService's own reference.
    monkeypatch.setattr("app.services.pipeline_resolution.PipelineService", _StubPipelineService)

    with pytest.raises(InvalidInputError):
        CollectionService(session).prompt_read(
            SimpleNamespace(id=uuid4(), name="Ghost", description=None, extra_metadata={}),
            SimpleNamespace(id=uuid4()),
        )


def test_update_prompt_persists_a_reference(session: Session) -> None:
    """The reference must survive to the database, not just the request session.

    Regression coverage: the JSON ``extra_metadata`` column is reassigned (never
    mutated in place) so SQLAlchemy tracks the change. The persistence
    assertion reads through a FRESH session so it can't pass via object identity.
    """
    from app.schemas.enums import PromptContext
    from app.schemas.prompts import PromptCreate, PromptReference
    from app.services.prompts.library import PromptLibraryService
    from app.services.prompts.usage import TOOL_PROMPT_REF_KEY

    user = _create_user(session)
    collection = _create_collection(session, user)
    library_prompt = PromptLibraryService(session).create(
        user.id,
        PromptCreate(
            name="Tool tone",
            context=PromptContext.CHAT_TOOL,
            body="Hello {{collection.name}}",
        ),
    )
    session.commit()
    service = CollectionService(session)

    updated = service.update_prompt(
        collection, user, PromptReference(prompt_id=library_prompt.id, version="latest")
    )
    assert updated.body == "Hello {{collection.name}}"
    assert updated.rendered

    with Session(session.get_bind()) as fresh:
        persisted = fresh.get(models.Collection, collection.id)
        assert persisted is not None
        stored = persisted.extra_metadata.get(TOOL_PROMPT_REF_KEY)
        assert stored == {"prompt_id": str(library_prompt.id), "version": "latest"}

