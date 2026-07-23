"""The collection-deletion cascade and its Pinecone-error classification.

The cascade is the spec: uploaded files are deleted, chat sessions are DETACHED
(not deleted) and their messages retained, and every owned row is purged. These
migrated from ``tests/api/test_collections_routes.py`` when Task 6.2 moved the
cascade into ``CollectionDeletionService``.
"""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import (
    AppSettingRepository,
    ChatRepository,
    CollectionRepository,
    UserRepository,
)
from app.services import collection_deletion as deletion_module
from app.services.app_config import invalidate_app_config_cache
from app.services.collection_deletion import CollectionDeletionService
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.pipelines import PipelineService
from app.vectorstores import registry as registry_module
from app.vectorstores.base import IndexSpec
from app.vectorstores.pgvector import PgvectorStore
from app.vectorstores.pinecone.store import is_missing_namespace_error
from tests.utils.providers import add_pinecone_connection, install_default_pipelines


@pytest.fixture(autouse=True)
def _invalidate_cache():
    """Config-cache hygiene: tests below override indexing.default_backend."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _use_pinecone_default(session: Session) -> None:
    AppSettingRepository(session).upsert("indexing.default_backend", "pinecone", updated_by=None)
    session.commit()
    invalidate_app_config_cache()


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


class _StubPineconeError:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def Index(self, _name: str):
        def _raise(**_kwargs):
            raise RuntimeError("pinecone exploded")

        return SimpleNamespace(delete=_raise)


class _StubFileStorage:
    def __init__(self) -> None:
        self.deleted: list[str | None] = []

    def delete_path(self, target_path) -> None:
        self.deleted.append(target_path)


class _StatusCodeError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class _ResponseStatusError(Exception):
    def __init__(self, message: str, response_status_code: int) -> None:
        super().__init__(message)
        self.response = SimpleNamespace(status_code=response_status_code)


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    add_pinecone_connection(session, user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    CollectionRepository(session).add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_is_missing_pinecone_namespace_variants() -> None:
    assert is_missing_namespace_error(Exception("Namespace not found")) is True
    assert is_missing_namespace_error(Exception("missing namespace")) is False
    assert is_missing_namespace_error(_StatusCodeError("namespace missing", 404)) is True
    assert is_missing_namespace_error(_StatusCodeError("namespace missing", 500)) is False
    assert is_missing_namespace_error(_ResponseStatusError("namespace missing", 404)) is True
    assert is_missing_namespace_error(_ResponseStatusError("namespace missing", 500)) is False


def test_delete_purges_rows_and_detaches_sessions(monkeypatch, session: Session) -> None:
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
    session.flush()
    # File purge walks the file tree, so give the document its file node
    # (what the lifespan backfill creates for pre-tree documents).
    file_node = models.FileNode(
        collection_id=collection.id,
        user_id=user.id,
        kind=models.FileNodeKind.FILE,
        name="doc.txt",
        content_type="text/plain",
        storage_path="/tmp/doc.txt",
    )
    session.add(file_node)
    session.flush()
    document.file_id = file_node.id
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
        session_id=chat_session.id, collection_ids=[collection.id]
    )
    session.add(models.ChatMessage(session_id=chat_session.id, role=models.ChatRole.USER, content="hi"))
    session.commit()

    storage = _StubFileStorage()
    monkeypatch.setattr(deletion_module, "FileStorage", lambda: storage)

    CollectionDeletionService(session).delete(user, collection)

    assert storage.deleted == ["/tmp/doc.txt"]
    assert session.get(models.Collection, collection.id) is None
    remaining_session = session.get(models.ChatSession, chat_session.id)
    assert remaining_session is not None
    assert remaining_session.collection_id is None  # detached, not deleted
    repo = ChatRepository(session)
    assert repo.list_session_collection_ids(chat_session.id) == []
    assert repo.list_messages(chat_session.id)  # messages retained


def test_delete_ignores_missing_namespace(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    _use_pinecone_default(session)
    collection = _create_collection(session, user)
    _add_document(session, user, collection, models.DocumentStatus.READY)

    monkeypatch.setattr(
        registry_module, "get_pinecone_client", lambda *_a, **_k: _StubPineconeMissingNamespace("key")
    )
    monkeypatch.setattr(deletion_module, "FileStorage", _StubFileStorage)

    CollectionDeletionService(session).delete(user, collection)

    assert session.get(models.Collection, collection.id) is None


def test_delete_surfaces_pinecone_error(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    _use_pinecone_default(session)
    collection = _create_collection(session, user)
    _add_document(session, user, collection, models.DocumentStatus.READY)

    monkeypatch.setattr(
        registry_module, "get_pinecone_client", lambda *_a, **_k: _StubPineconeError("key")
    )
    monkeypatch.setattr(deletion_module, "FileStorage", _StubFileStorage)

    with pytest.raises(ExternalServiceError):
        CollectionDeletionService(session).delete(user, collection)

    # A failed vector purge aborts before the row purge -- the collection survives.
    assert session.get(models.Collection, collection.id) is not None


def test_delete_rejects_unresolvable_ingestion_pipeline(monkeypatch, session: Session) -> None:
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

    monkeypatch.setattr("app.services.pipeline_resolution.PipelineService", _StubPipelineService)
    monkeypatch.setattr(deletion_module, "FileStorage", _StubFileStorage)

    with pytest.raises(InvalidInputError):
        CollectionDeletionService(session).delete(user, collection)


def test_delete_rejects_missing_namespace(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    PipelineService(session).ensure_default_pipelines(user)
    session.commit()

    monkeypatch.setattr(
        "app.services.pipeline_resolution.resolve_pipeline_settings",
        lambda *_a, **_k: SimpleNamespace(namespace=None, index_name="index", backend=None),
    )
    monkeypatch.setattr(deletion_module, "FileStorage", _StubFileStorage)

    with pytest.raises(InvalidInputError):
        CollectionDeletionService(session).delete(user, collection)


def test_delete_purges_pgvector_namespace_without_pinecone(
    monkeypatch, pgvector_session: Session
) -> None:
    """A pgvector-backed collection's deletion purges its namespace rows and
    never constructs a Pinecone client."""
    session = pgvector_session
    user = _create_user(session)
    collection = _create_collection(session, user)

    store = PgvectorStore(session)
    store.create_index(IndexSpec(name="ragworks", dimension=2, metric="cosine"))
    from app.retrieval.models import DocumentChunk, DocumentMetadata

    namespace = f"col-{collection.id}"
    store.upsert(
        "ragworks",
        namespace,
        [
            DocumentChunk(
                document_id="doc",
                chunk_id="doc:0",
                text="x",
                order=0,
                metadata=DocumentMetadata(),
                embedding=[0.1, 0.2],
            )
        ],
    )
    _add_document(session, user, collection, models.DocumentStatus.READY)
    session.commit()

    def _no_pinecone(*_a, **_k):
        raise AssertionError("Pinecone client must not be constructed for pgvector purge")

    monkeypatch.setattr(registry_module, "get_pinecone_client", _no_pinecone)
    monkeypatch.setattr(deletion_module, "FileStorage", _StubFileStorage)

    CollectionDeletionService(session).delete(user, collection)

    assert session.get(models.Collection, collection.id) is None
    assert store.query("ragworks", namespace, embedding=[0.1, 0.2], top_k=5).matches == []


def _add_document(session: Session, user, collection, status) -> models.Document:
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="doc.txt",
        content_type="text/plain",
        status=status,
        num_chunks=0,
        num_tokens=0,
        chunk_size=128,
        chunk_overlap=8,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed-model",
        source_path="/tmp/doc.txt",
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def _keyless_user(session: Session) -> models.User:
    """A user with defaults installed but no Pinecone connection."""
    user = models.User(
        email="keyless@example.com",
        full_name="Keyless",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def test_delete_skips_vector_purge_when_nothing_was_indexed(monkeypatch, session: Session) -> None:
    """A Pinecone-backed collection whose ingests all FAILED holds no vectors,
    so deleting it must not demand a Pinecone key (regression: users without a
    key were unable to delete collections stuck on a Pinecone default)."""
    user = _keyless_user(session)
    _use_pinecone_default(session)
    collection = _create_collection(session, user)
    _add_document(session, user, collection, models.DocumentStatus.FAILED)

    def _no_client(*_a, **_k):
        raise AssertionError("No vector store should be constructed for an unindexed collection")

    monkeypatch.setattr(deletion_module, "get_vector_store", _no_client)
    monkeypatch.setattr(deletion_module, "FileStorage", _StubFileStorage)

    CollectionDeletionService(session).delete(user, collection)

    assert session.get(models.Collection, collection.id) is None


def test_delete_with_indexed_documents_still_requires_the_backend(
    monkeypatch, session: Session
) -> None:
    """READY documents mean vectors exist upstream — the purge (and its key
    requirement) must not be skipped, or Pinecone data would be stranded."""
    user = _keyless_user(session)
    _use_pinecone_default(session)
    collection = _create_collection(session, user)
    _add_document(session, user, collection, models.DocumentStatus.READY)
    monkeypatch.setattr(deletion_module, "FileStorage", _StubFileStorage)

    with pytest.raises(InvalidInputError, match="Pinecone connection"):
        CollectionDeletionService(session).delete(user, collection)

    assert session.get(models.Collection, collection.id) is not None
