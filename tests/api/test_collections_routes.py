from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import collections as collections_routes
from app.db import models
from app.db.models import ChunkStrategy
from app.db.repositories import CollectionRepository, UserRepository
from app.schemas.collections import ChunkSettings, CollectionCreate, CollectionPromptUpdate, CollectionUpdate
from app.schemas.models import ModelInfo


class _StubSettings:
    default_embedding_model = "embed-model"
    default_chat_model = "chat-model"
    pinecone_index_name = "unit-index"
    pinecone_api_key = "pinecone-key"
    pinecone_cloud = "aws"
    pinecone_region = "us-east-1"


class _StubOpenRouter:
    def __init__(self, embed_payload: dict[str, object]) -> None:
        self.embed_payload = embed_payload
        self.calls: list[dict[str, object]] = []

    def get_model(self, model_id: str) -> ModelInfo:
        if "embed" in model_id:
            return ModelInfo(id=model_id, name="Embed", context_length=2048)
        return ModelInfo(id=model_id, name="Chat", context_length=4096)

    def embed(self, texts, model: str | None = None):
        self.calls.append({"texts": list(texts), "model": model})
        return dict(self.embed_payload)


class _StubPinecone:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.indexes: list[str] = []

    def Index(self, name: str):
        self.indexes.append(name)
        return SimpleNamespace(delete=lambda **_kwargs: None)


class _StubPineconeIndexer:
    last_config = None

    def __init__(self, client) -> None:
        self.client = client

    def ensure_index(self, config) -> None:
        _StubPineconeIndexer.last_config = config


class _StubFileStorage:
    def __init__(self) -> None:
        self.deleted: list[str | None] = []

    def delete_path(self, target_path) -> None:
        self.deleted.append(target_path)


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(email="user@example.com", full_name="User", hashed_password="hashed")
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
        embedding_model="embed-model",
        chat_model="chat-model",
        context_window=1024,
        chunk_size=128,
        chunk_overlap=8,
        chunk_strategy=ChunkStrategy.TOKEN,
        pinecone_index="idx",
        pinecone_namespace=f"ns-{uuid4().hex[:6]}",
        extra_metadata={"embedding_dimension": 128},
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


def test_create_collection_success(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    openrouter = _StubOpenRouter({"data": [{"embedding": [0.1, 0.2]}]})

    monkeypatch.setattr(collections_routes, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(collections_routes, "get_openrouter_client", lambda: openrouter)
    monkeypatch.setattr(collections_routes, "Pinecone", _StubPinecone)
    monkeypatch.setattr(collections_routes, "PineconeIndexer", _StubPineconeIndexer)

    payload = CollectionCreate(name="Unit Collection", description="Test")
    created = collections_routes.create_collection(payload, current_user=user, session=session)

    assert created.chunk_settings.chunk_size == 2048
    assert _StubPineconeIndexer.last_config.dimension == 2


def test_create_collection_errors_on_empty_embeddings(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    openrouter = _StubOpenRouter({"data": []})

    monkeypatch.setattr(collections_routes, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(collections_routes, "get_openrouter_client", lambda: openrouter)
    monkeypatch.setattr(collections_routes, "Pinecone", _StubPinecone)
    monkeypatch.setattr(collections_routes, "PineconeIndexer", _StubPineconeIndexer)

    payload = CollectionCreate(name="Unit Collection", description="Test")

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.create_collection(payload, current_user=user, session=session)

    assert excinfo.value.status_code == 502


def test_create_collection_errors_on_zero_dimension(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    openrouter = _StubOpenRouter({"data": [{"embedding": []}]})

    monkeypatch.setattr(collections_routes, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(collections_routes, "get_openrouter_client", lambda: openrouter)
    monkeypatch.setattr(collections_routes, "Pinecone", _StubPinecone)
    monkeypatch.setattr(collections_routes, "PineconeIndexer", _StubPineconeIndexer)

    payload = CollectionCreate(name="Unit Collection", description="Test")

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.create_collection(payload, current_user=user, session=session)

    assert excinfo.value.status_code == 502


def test_update_collection_updates_fields(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    payload = CollectionUpdate(
        name="Updated",
        description="Updated desc",
        metadata={"owner": "unit"},
        chunk_settings=ChunkSettings(chunk_size=256, chunk_overlap=64, strategy=ChunkStrategy.SENTENCE),
    )

    updated = collections_routes.update_collection(collection.id, payload, current_user=user, session=session)

    assert updated.name == "Updated"
    assert updated.chunk_settings.chunk_size == 256
    assert updated.chunk_settings.strategy == ChunkStrategy.SENTENCE


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
        chunk_size=collection.chunk_size,
        chunk_overlap=collection.chunk_overlap,
        chunk_strategy=collection.chunk_strategy,
        embedding_model=collection.embedding_model,
        source_path="/tmp/doc.txt",
    )
    session.add(document)

    chat_session = models.ChatSession(
        user_id=user.id,
        collection_id=collection.id,
        title="Chat",
        mode=models.ChatMode.CHAT,
        chat_model=collection.chat_model,
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
    monkeypatch.setattr(collections_routes, "get_settings", lambda: _StubSettings())
    monkeypatch.setattr(collections_routes, "Pinecone", _StubPinecone)
    monkeypatch.setattr(collections_routes, "FileStorage", lambda: storage)

    response = collections_routes.delete_collection(collection.id, current_user=user, session=session)

    assert response.status == "deleted"
    assert storage.deleted == ["/tmp/doc.txt"]
    assert session.get(models.Collection, collection.id) is None
