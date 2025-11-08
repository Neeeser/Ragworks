from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.db import models
from app.db.models import ChunkStrategy, DocumentStatus
from app.db.repositories import (
    ChunkRepository,
    CollectionRepository,
    DocumentRepository,
    UserRepository,
)


@pytest.fixture(name="session")
def session_fixture() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _create_user(session: Session) -> models.User:
    repo = UserRepository(session)
    user = models.User(email="user@example.com", full_name="Example User", hashed_password="hashed")
    repo.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    repo = CollectionRepository(session)
    collection = models.Collection(
        user_id=user.id,
        name="Test Collection",
        description="Unit test",
        embedding_model="qwen/qwen3-embedding-0.6b",
        chat_model="openai/gpt-oss-120b",
        context_window=8192,
        chunk_size=512,
        chunk_overlap=32,
        chunk_strategy=ChunkStrategy.TOKEN,
        pinecone_index="unit-tests",
        pinecone_namespace=f"ns-{uuid4().hex[:8]}",
        metadata={"embedding_dimension": 512},
    )
    repo.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_document(session: Session, user: models.User, collection: models.Collection) -> models.Document:
    repo = DocumentRepository(session)
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="example.txt",
        content_type="text/plain",
        status=DocumentStatus.PROCESSING,
        num_chunks=0,
        num_tokens=0,
        chunk_size=collection.chunk_size,
        chunk_overlap=collection.chunk_overlap,
        chunk_strategy=collection.chunk_strategy,
        embedding_model=collection.embedding_model,
    )
    repo.add(document)
    session.commit()
    session.refresh(document)
    return document


def test_user_repository_roundtrip(session: Session) -> None:
    repo = UserRepository(session)
    user = models.User(email="roundtrip@example.com", full_name="Round Trip", hashed_password="hashed")
    repo.add(user)
    session.commit()

    fetched = repo.get(user.id)
    assert fetched is not None
    assert fetched.email == "roundtrip@example.com"
    assert repo.get_by_email("roundtrip@example.com") is not None


def test_collection_repository_lists_per_user(session: Session) -> None:
    user = _create_user(session)
    repo = CollectionRepository(session)
    created = _create_collection(session, user)

    listings = repo.list_for_user(user.id)
    assert len(listings) == 1
    assert listings[0].id == created.id


def test_document_and_chunk_repositories(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    document = _create_document(session, user, collection)

    doc_repo = DocumentRepository(session)
    assert len(list(doc_repo.list_for_collection(collection.id))) == 1

    chunk_repo = ChunkRepository(session)
    chunk_record = models.DocumentChunkRecord(
        document_id=document.id,
        collection_id=collection.id,
        chunk_index=0,
        text="Hello world chunk",
        embedding=[0.1, 0.2, 0.3],
        chunk_metadata={"source": "unit-test"},
        chunk_size=collection.chunk_size,
        chunk_overlap=collection.chunk_overlap,
        chunk_strategy=collection.chunk_strategy,
        embedding_model=collection.embedding_model,
    )
    chunk_repo.add_many([chunk_record])
    session.commit()

    stored = list(chunk_repo.list_for_document(document.id))
    assert len(stored) == 1
    assert stored[0].chunk_metadata["source"] == "unit-test"
    assert stored[0].embedding_model == collection.embedding_model
