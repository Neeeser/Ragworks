"""Tests for the chunk-detail endpoint the insight inspector docks from."""

from __future__ import annotations

from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlmodel import Session

from app.api.routes import documents as documents_routes
from app.db import models


def _create_user(session: Session, email: str = "chunks@example.com") -> models.User:
    user = models.User(email=email, full_name="Chunk User", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_corpus(
    session: Session, user: models.User
) -> tuple[models.Collection, models.Document, list[models.DocumentChunkRecord]]:
    collection = models.Collection(
        user_id=user.id, name="Chunk Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="Chunk Doc",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=2,
        num_tokens=0,
        chunk_size=100,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="test-embed",
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    chunks = [
        models.DocumentChunkRecord(
            document_id=document.id,
            collection_id=collection.id,
            chunk_index=index,
            text=f"Chunk {index}",
            embedding=[float(index), 1.0],
            chunk_metadata={},
            chunk_size=10,
            chunk_overlap=0,
            chunk_strategy=models.ChunkStrategy.TOKEN,
            embedding_model="test-embed",
        )
        for index in range(2)
    ]
    session.add_all(chunks)
    session.commit()
    for chunk in chunks:
        session.refresh(chunk)
    return collection, document, chunks


def test_get_chunk_detail_returns_payload(session: Session) -> None:
    """Ensure chunk detail endpoint returns chunk metadata."""
    user = _create_user(session)
    _, document, chunks = _create_corpus(session, user)

    response = documents_routes.get_chunk_detail(
        chunks[0].id, current_user=user, session=session
    )

    assert response.chunk.id == chunks[0].id
    assert response.document.id == document.id


def test_get_chunk_detail_rejects_missing(session: Session) -> None:
    """Ensure chunk detail endpoint rejects unknown chunks."""
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        documents_routes.get_chunk_detail(UUID(int=0), current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_get_chunk_detail_rejects_other_user(session: Session) -> None:
    """Ensure chunk detail endpoint enforces ownership."""
    user = _create_user(session)
    other = _create_user(session, email="chunk-other@example.com")
    _, _, chunks = _create_corpus(session, other)

    with pytest.raises(HTTPException) as excinfo:
        documents_routes.get_chunk_detail(
            chunks[0].id, current_user=user, session=session
        )

    assert excinfo.value.status_code == 404
