from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import collections as collections_routes
from app.db import models
from app.db.repositories import CollectionRepository, UserRepository
from app.schemas.collections import (
    CollectionCreate,
    CollectionPipelineOverrides,
    CollectionPromptUpdate,
    CollectionUpdate,
    PipelineNodeOverride,
)
from app.services.pipelines import PipelineService


class _StubPinecone:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.indexes: list[str] = []

    def Index(self, name: str):
        self.indexes.append(name)
        return SimpleNamespace(delete=lambda **_kwargs: None)


class _StubFileStorage:
    def __init__(self) -> None:
        self.deleted: list[str | None] = []

    def delete_path(self, target_path) -> None:
        self.deleted.append(target_path)


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    repo = CollectionRepository(session)
    collection = models.Collection(
        user_id=user.id,
        name="Collection",
        description="",
        extra_metadata={},
    )
    repo.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_get_collection_and_prompt_missing(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.get_collection(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.get_collection_prompt(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_get_collection_and_prompt_success(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    fetched = collections_routes.get_collection(collection.id, current_user=user, session=session)
    prompt = collections_routes.get_collection_prompt(collection.id, current_user=user, session=session)

    assert fetched.id == collection.id
    assert prompt.template


def test_update_and_delete_collection_missing(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.update_collection(uuid4(), CollectionUpdate(name="x"), current_user=user, session=session)
    assert excinfo.value.status_code == 404

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.update_collection_prompt(
            uuid4(),
            CollectionPromptUpdate(template="hello"),
            current_user=user,
            session=session,
        )
    assert excinfo.value.status_code == 404

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.delete_collection(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_create_collection_success(session: Session) -> None:
    user = _create_user(session)

    payload = CollectionCreate(name="Unit Collection", description="Test")
    created = collections_routes.create_collection(payload, current_user=user, session=session)

    assert created.ingestion_pipeline_id is not None
    assert created.retrieval_pipeline_id is not None


def test_update_collection_updates_fields(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    payload = CollectionUpdate(
        name="Updated",
        description="Updated desc",
        metadata={"owner": "unit"},
    )

    updated = collections_routes.update_collection(collection.id, payload, current_user=user, session=session)

    assert updated.name == "Updated"
    assert updated.metadata["owner"] == "unit"


def test_create_collection_with_pipeline_overrides(session: Session) -> None:
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    session.commit()

    ingestion_definition = pipeline_service.get_definition(defaults.ingestion)
    retrieval_definition = pipeline_service.get_definition(defaults.retrieval)
    chunker_node = next(node for node in ingestion_definition.nodes if node.type == "chunker.collection")
    chat_node = next(node for node in retrieval_definition.nodes if node.type == "chat.settings")

    payload = CollectionCreate(
        name="Overrides Collection",
        description="Test overrides",
        pipeline_overrides=CollectionPipelineOverrides(
            ingestion=[
                PipelineNodeOverride(node_id=chunker_node.id, config={"chunk_size": 2048}),
            ],
            retrieval=[
                PipelineNodeOverride(node_id=chat_node.id, config={"context_window": 4096}),
            ],
        ),
    )

    created = collections_routes.create_collection(payload, current_user=user, session=session)

    assert created.ingestion_pipeline_id is not None
    assert created.retrieval_pipeline_id is not None
    assert created.ingestion_pipeline_id != defaults.ingestion.id
    assert created.retrieval_pipeline_id != defaults.retrieval.id

    ingestion_pipeline = pipeline_service.get_pipeline(created.ingestion_pipeline_id, user.id)
    retrieval_pipeline = pipeline_service.get_pipeline(created.retrieval_pipeline_id, user.id)
    assert ingestion_pipeline is not None
    assert retrieval_pipeline is not None

    ingestion_definition = pipeline_service.get_definition(ingestion_pipeline)
    retrieval_definition = pipeline_service.get_definition(retrieval_pipeline)
    updated_chunker = next(node for node in ingestion_definition.nodes if node.type == "chunker.collection")
    updated_chat = next(node for node in retrieval_definition.nodes if node.type == "chat.settings")

    assert updated_chunker.config["chunk_size"] == 2048
    assert updated_chunker.config["chunk_overlap"] == 200
    assert updated_chat.config["context_window"] == 4096


def test_update_collection_prompt_sets_and_clears_template(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    updated = collections_routes.update_collection_prompt(
        collection.id,
        CollectionPromptUpdate(template="Hello {{collection.name}}"),
        current_user=user,
        session=session,
    )
    assert updated.template
    assert updated.rendered

    updated = collections_routes.update_collection_prompt(
        collection.id,
        CollectionPromptUpdate(template="  "),
        current_user=user,
        session=session,
    )
    assert "TransparentRAG" in updated.rendered


def test_delete_collection_removes_records(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=0,
        num_tokens=0,
        chunk_size=128,
        chunk_overlap=8,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed-model",
        source_path="/tmp/doc.txt",
    )
    session.add(document)

    chat_session = models.ChatSession(
        user_id=user.id,
        collection_id=collection.id,
        title="Chat",
        mode=models.ChatMode.CHAT,
        chat_model="chat-model",
        context_tokens=0,
    )
    session.add(chat_session)
    session.flush()

    session.add(
        models.ChatMessage(
            session_id=chat_session.id,
            role=models.ChatRole.USER,
            content="hi",
        )
    )
    session.commit()

    storage = _StubFileStorage()
    monkeypatch.setattr(
        collections_routes,
        "get_pinecone_client",
        lambda **_kwargs: _StubPinecone(api_key="key"),
    )
    monkeypatch.setattr(collections_routes, "FileStorage", lambda: storage)

    response = collections_routes.delete_collection(collection.id, current_user=user, session=session)

    assert response.status == "deleted"
    assert storage.deleted == ["/tmp/doc.txt"]
    assert session.get(models.Collection, collection.id) is None
