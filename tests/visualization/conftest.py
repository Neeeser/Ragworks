"""Shared builders for insight tests: a user, collection, and chunk corpus."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlmodel import Session

from app.db import models


@pytest.fixture(name="user")
def user_fixture(session: Session) -> models.User:
    """A persisted user owning the test collection."""
    user = models.User(
        email="insights@example.com", full_name="Insight User", hashed_password="hashed"
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


@pytest.fixture(name="collection")
def collection_fixture(session: Session, user: models.User) -> models.Collection:
    """A persisted collection to hang documents off."""
    collection = models.Collection(
        user_id=user.id,
        name="Insight Collection",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def add_document(
    session: Session,
    collection: models.Collection,
    user: models.User,
    name: str,
    chunks: list[tuple[str, list[float]]],
    embedding_model: str = "test-embed",
) -> models.Document:
    """Persist a READY document with the given (text, embedding) chunks."""
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name=name,
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=len(chunks),
        num_tokens=0,
        chunk_size=100,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model=embedding_model,
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    for index, (text, embedding) in enumerate(chunks):
        session.add(
            models.DocumentChunkRecord(
                document_id=document.id,
                collection_id=collection.id,
                chunk_index=index,
                text=text,
                embedding=embedding,
                chunk_metadata={},
                chunk_size=100,
                chunk_overlap=0,
                chunk_strategy=models.ChunkStrategy.TOKEN,
                embedding_model=embedding_model if embedding else "",
            )
        )
    session.commit()
    return document


def chunk_ids(session: Session, document_id: UUID) -> list[UUID]:
    """The document's chunk ids in chunk order."""
    from sqlmodel import col, select

    return list(
        session.exec(
            select(col(models.DocumentChunkRecord.id))
            .where(col(models.DocumentChunkRecord.document_id) == document_id)
            .order_by(col(models.DocumentChunkRecord.chunk_index))
        ).all()
    )
