from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import collections as collections_routes
from app.db import models
from app.db.repositories import ChatRepository, CollectionRepository, UserRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.schemas.collections import (
    CollectionCreate,
    CollectionPipelineOverrides,
    CollectionPromptUpdate,
    CollectionUpdate,
    PipelineNodeOverride,
)
from app.services.pipelines import PipelineService
from app.services.prompts import SYSTEM_PROMPT_METADATA_KEY


class _StubPinecone:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.indexes: list[str] = []

    def Index(self, name: str):
        self.indexes.append(name)
        return SimpleNamespace(delete=lambda **_kwargs: None)


class _NamespaceNotFoundError(Exception):
    def __init__(self, message: str = "Namespace not found") -> None:
        super().__init__(message)
        self.status_code = 404


class _StubPineconeMissingNamespace:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def Index(self, _name: str):
        def _raise(**_kwargs):
            raise _NamespaceNotFoundError()

        return SimpleNamespace(delete=_raise)


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
    chunker_node = next(node for node in ingestion_definition.nodes if node.type == "chunker.token")
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
    updated_chunker = next(node for node in ingestion_definition.nodes if node.type == "chunker.token")
    updated_chat = next(node for node in retrieval_definition.nodes if node.type == "chat.settings")

    assert updated_chunker.config["chunk_size"] == 2048
    assert updated_chunker.config["chunk_overlap"] == 200
    assert updated_chat.config["context_window"] == 4096


def test_create_collection_rejects_invalid_pipeline_kind(session: Session) -> None:
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    retrieval_pipeline = pipeline_service.create_pipeline(
        user=user,
        name="Retrieval",
        kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()

    payload = CollectionCreate(
        name="Invalid",
        ingestion_pipeline_id=retrieval_pipeline.id,
    )

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.create_collection(payload, current_user=user, session=session)

    assert excinfo.value.status_code == 400


def test_create_collection_with_ingestion_overrides_only(session: Session) -> None:
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    session.commit()

    ingestion_definition = pipeline_service.get_definition(defaults.ingestion)
    chunker_node = next(node for node in ingestion_definition.nodes if node.type == "chunker.token")

    payload = CollectionCreate(
        name="Overrides Collection",
        description="Test overrides",
        pipeline_overrides=CollectionPipelineOverrides(
            ingestion=[PipelineNodeOverride(node_id=chunker_node.id, config={"chunk_size": 2048})],
        ),
    )

    created = collections_routes.create_collection(payload, current_user=user, session=session)

    assert created.ingestion_pipeline_id is not None
    assert created.ingestion_pipeline_id != defaults.ingestion.id


def test_create_collection_with_retrieval_overrides_only(session: Session) -> None:
    user = _create_user(session)
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    session.commit()

    retrieval_definition = pipeline_service.get_definition(defaults.retrieval)
    chat_node = next(node for node in retrieval_definition.nodes if node.type == "chat.settings")

    payload = CollectionCreate(
        name="Overrides Collection",
        description="Test overrides",
        pipeline_overrides=CollectionPipelineOverrides(
            retrieval=[PipelineNodeOverride(node_id=chat_node.id, config={"context_window": 4096})],
        ),
    )

    created = collections_routes.create_collection(payload, current_user=user, session=session)

    assert created.retrieval_pipeline_id is not None
    assert created.retrieval_pipeline_id != defaults.retrieval.id


class _StatusCodeError(Exception):
    """Exception exposing a raw `status_code` attribute, like some SDK errors."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class _ResponseStatusError(Exception):
    """Exception exposing a nested `response.status_code`, like httpx-style errors."""

    def __init__(self, message: str, response_status_code: int) -> None:
        super().__init__(message)
        self.response = SimpleNamespace(status_code=response_status_code)


def test_is_missing_pinecone_namespace_variants() -> None:
    assert collections_routes._is_missing_pinecone_namespace(Exception("Namespace not found")) is True
    assert collections_routes._is_missing_pinecone_namespace(Exception("missing namespace")) is False

    # status_code branch: only fires when the message also mentions "namespace" and
    # doesn't already match the "namespace not found" branch above.
    assert (
        collections_routes._is_missing_pinecone_namespace(
            _StatusCodeError("namespace missing", status_code=404)
        )
        is True
    )
    assert (
        collections_routes._is_missing_pinecone_namespace(
            _StatusCodeError("namespace missing", status_code=500)
        )
        is False
    )

    # response.status_code branch: same shape, via a nested response object.
    assert (
        collections_routes._is_missing_pinecone_namespace(
            _ResponseStatusError("namespace missing", response_status_code=404)
        )
        is True
    )
    assert (
        collections_routes._is_missing_pinecone_namespace(
            _ResponseStatusError("namespace missing", response_status_code=500)
        )
        is False
    )


def test_build_collection_stats_with_empty_list(session: Session) -> None:
    stats = collections_routes._build_collection_stats(session, uuid4(), [])

    assert stats == {}


def test_prompt_read_rejects_missing_pipeline(monkeypatch, session: Session) -> None:
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

    monkeypatch.setattr(collections_routes, "PipelineService", _StubPipelineService)

    with pytest.raises(HTTPException) as excinfo:
        collections_routes._prompt_read(
            collection=SimpleNamespace(ingestion_pipeline_id=None, retrieval_pipeline_id=None),
            user=SimpleNamespace(id=uuid4()),
            session=session,
        )

    assert excinfo.value.status_code == 400


def test_update_collection_prompt_sets_and_clears_template(session: Session) -> None:
    """Prompt updates must survive to the database, not just the request session.

    Regression test: the route once mutated the JSON `extra_metadata` column in
    place, which SQLAlchemy never tracks -- the response looked right (same
    in-memory object) while nothing was ever written. Every persistence
    assertion here reads back through a FRESH session so it cannot pass via
    object identity.
    """
    user = _create_user(session)
    collection = _create_collection(session, user)
    original_updated_at = collection.updated_at

    updated = collections_routes.update_collection_prompt(
        collection.id,
        CollectionPromptUpdate(template="Hello {{collection.name}}"),
        current_user=user,
        session=session,
    )
    assert updated.template
    assert updated.rendered

    with Session(session.get_bind()) as fresh:
        persisted = fresh.get(models.Collection, collection.id)
        assert persisted is not None
        assert (
            persisted.extra_metadata.get(SYSTEM_PROMPT_METADATA_KEY)
            == "Hello {{collection.name}}"
        )
        # The row is genuinely dirty now, so TimestampMixin's onupdate fires.
        assert persisted.updated_at > original_updated_at

    updated = collections_routes.update_collection_prompt(
        collection.id,
        CollectionPromptUpdate(template="  "),
        current_user=user,
        session=session,
    )
    assert "Tool context" in updated.rendered

    with Session(session.get_bind()) as fresh:
        persisted = fresh.get(models.Collection, collection.id)
        assert persisted is not None
        assert SYSTEM_PROMPT_METADATA_KEY not in persisted.extra_metadata


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
    ChatRepository(session).replace_session_collections(
        session_id=chat_session.id,
        collection_ids=[collection.id],
    )

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
    remaining_session = session.get(models.ChatSession, chat_session.id)
    assert remaining_session is not None
    assert remaining_session.collection_id is None
    repo = ChatRepository(session)
    assert repo.list_session_collection_ids(chat_session.id) == []
    assert repo.list_messages(chat_session.id)


def test_delete_collection_ignores_missing_namespace(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    storage = _StubFileStorage()
    monkeypatch.setattr(
        collections_routes,
        "get_pinecone_client",
        lambda **_kwargs: _StubPineconeMissingNamespace(api_key="key"),
    )
    monkeypatch.setattr(collections_routes, "FileStorage", lambda: storage)

    response = collections_routes.delete_collection(collection.id, current_user=user, session=session)

    assert response.status == "deleted"
    assert session.get(models.Collection, collection.id) is None


def test_collection_stats_include_query_latency(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    session.add_all(
        [
            models.Document(
                collection_id=collection.id,
                user_id=user.id,
                name="doc-a.txt",
                content_type="text/plain",
                status=models.DocumentStatus.READY,
                num_chunks=3,
                num_tokens=120,
                chunk_size=128,
                chunk_overlap=8,
                chunk_strategy=models.ChunkStrategy.TOKEN,
                embedding_model="embed-model",
            ),
            models.Document(
                collection_id=collection.id,
                user_id=user.id,
                name="doc-b.txt",
                content_type="text/plain",
                status=models.DocumentStatus.READY,
                num_chunks=5,
                num_tokens=240,
                chunk_size=128,
                chunk_overlap=8,
                chunk_strategy=models.ChunkStrategy.TOKEN,
                embedding_model="embed-model",
            ),
        ]
    )

    session.add_all(
        [
            models.QueryEvent(
                user_id=user.id,
                collection_id=collection.id,
                query_text="query a",
                top_k=3,
                model="embed-model",
                context_tokens=12,
                latency_ms=120.0,
                response_payload={"match_count": 3},
            ),
            models.QueryEvent(
                user_id=user.id,
                collection_id=collection.id,
                query_text="query b",
                top_k=3,
                model="embed-model",
                context_tokens=14,
                latency_ms=180.0,
                response_payload={"match_count": 2},
            ),
        ]
    )
    session.commit()

    stats = collections_routes.get_collection_stats(
        collection.id,
        current_user=user,
        session=session,
    )
    assert stats.document_count == 2
    assert stats.chunk_count == 8
    assert stats.average_latency_ms == pytest.approx(150.0, rel=1e-3)
    assert stats.last_used_at is not None

    stats_list = collections_routes.list_collection_stats(current_user=user, session=session)
    stats_map = {entry.collection_id: entry for entry in stats_list}
    assert stats_map[collection.id].chunk_count == 8


def test_update_collection_rejects_invalid_pipeline_kind(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline_service = PipelineService(session)
    # Created only to give the collection a real ingestion pipeline to keep alongside;
    # the assertion below is about rejecting a retrieval-kind pipeline id.
    pipeline_service.create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    retrieval_pipeline = pipeline_service.create_pipeline(
        user=user,
        name="Retrieval",
        kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.update_collection(
            collection.id,
            CollectionUpdate(ingestion_pipeline_id=retrieval_pipeline.id),
            current_user=user,
            session=session,
        )
    assert excinfo.value.status_code == 400


def test_update_collection_assigns_pipeline_ids(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline_service = PipelineService(session)
    ingestion_pipeline = pipeline_service.create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    retrieval_pipeline = pipeline_service.create_pipeline(
        user=user,
        name="Retrieval",
        kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()

    updated = collections_routes.update_collection(
        collection.id,
        CollectionUpdate(
            ingestion_pipeline_id=ingestion_pipeline.id,
            retrieval_pipeline_id=retrieval_pipeline.id,
        ),
        current_user=user,
        session=session,
    )

    assert updated.ingestion_pipeline_id == ingestion_pipeline.id
    assert updated.retrieval_pipeline_id == retrieval_pipeline.id

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.update_collection(
            collection.id,
            CollectionUpdate(retrieval_pipeline_id=ingestion_pipeline.id),
            current_user=user,
            session=session,
        )
    assert excinfo.value.status_code == 400


def test_delete_collection_rejects_missing_ingestion_pipeline(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

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

    monkeypatch.setattr(collections_routes, "PipelineService", _StubPipelineService)
    monkeypatch.setattr(
        collections_routes,
        "get_pinecone_client",
        lambda **_kwargs: _StubPinecone(api_key="key"),
    )

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.delete_collection(collection.id, current_user=user, session=session)

    assert excinfo.value.status_code == 400
    assert "Unable to resolve ingestion pipeline" in excinfo.value.detail


def test_delete_collection_rejects_missing_namespace(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    PipelineService(session).ensure_default_pipelines(user)
    session.commit()

    monkeypatch.setattr(
        collections_routes,
        "resolve_ingestion_settings",
        lambda *_args, **_kwargs: SimpleNamespace(namespace=None, index_name="index"),
    )
    monkeypatch.setattr(
        collections_routes,
        "get_pinecone_client",
        lambda **_kwargs: _StubPinecone(api_key="key"),
    )

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.delete_collection(collection.id, current_user=user, session=session)

    assert excinfo.value.status_code == 400
    assert "namespace is not configured" in excinfo.value.detail
