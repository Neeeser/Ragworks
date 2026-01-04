"""Tests for visualization and chunk detail routes."""

from __future__ import annotations

from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.routes import documents as documents_routes
from app.api.routes import visualizations as visualizations_routes
from app.db import models
from app.schemas.visualization import UmapComputeRequest


def _create_user(session: Session) -> models.User:
    """Create and persist a user for visualization tests."""
    user = models.User(
        email="viz@example.com",
        full_name="Viz User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user_id: UUID) -> models.Collection:
    """Create and persist a collection for visualization tests."""
    collection = models.Collection(
        user_id=user_id,
        name="Visualization Collection",
        description="",
        ingestion_pipeline_id=None,
        retrieval_pipeline_id=None,
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_document(session: Session, collection: models.Collection, user: models.User) -> models.Document:
    """Create and persist a document for visualization tests."""
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="Visualization Doc",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=3,
        num_tokens=0,
        chunk_size=100,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="test-embed",
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def _create_chunks(
    session: Session,
    document: models.Document,
    collection: models.Collection,
    embeddings: list[list[float]] | None = None,
) -> list[models.DocumentChunkRecord]:
    """Create and persist chunk records for a document."""
    if embeddings is None:
        embeddings = [
            [0.0, 1.0, 2.0],
            [1.0, 2.0, 3.0],
            [2.0, 3.0, 4.0],
        ]
    chunks = []
    for index, embedding in enumerate(embeddings):
        chunk = models.DocumentChunkRecord(
            document_id=document.id,
            collection_id=collection.id,
            chunk_index=index,
            text=f"Chunk {index}",
            embedding=embedding,
            chunk_metadata={"source": "unit"},
            chunk_size=10,
            chunk_overlap=0,
            chunk_strategy=models.ChunkStrategy.TOKEN,
            embedding_model=document.embedding_model,
        )
        chunks.append(chunk)
    session.add_all(chunks)
    session.commit()
    for chunk in chunks:
        session.refresh(chunk)
    return chunks


def test_get_collection_umap_missing_projection(session: Session) -> None:
    """Ensure missing UMAP projections return 404."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)

    with pytest.raises(HTTPException) as excinfo:
        visualizations_routes.get_collection_umap(
            collection.id,
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 404


def test_compute_collection_umap_creates_projection(session: Session) -> None:
    """Ensure UMAP computation persists projection data."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)
    document = _create_document(session, collection, user)
    _create_chunks(session, document, collection)

    payload = UmapComputeRequest(n_neighbors=2, min_dist=0.0, random_state=1)
    response = visualizations_routes.compute_collection_umap(
        collection.id,
        payload,
        current_user=user,
        session=session,
    )

    assert response.projection.collection_id == collection.id
    assert response.projection.point_count == 3
    assert response.projection.n_neighbors == 2
    assert len(response.points) == 3

    fetched = visualizations_routes.get_collection_umap(
        collection.id,
        current_user=user,
        session=session,
    )
    assert fetched.projection.id == response.projection.id
    assert len(fetched.points) == 3

    refreshed = visualizations_routes.compute_collection_umap(
        collection.id,
        payload,
        current_user=user,
        session=session,
    )
    assert refreshed.projection.id != response.projection.id

    projections = session.exec(select(models.UmapProjectionRecord)).all()
    points = session.exec(select(models.UmapPointRecord)).all()
    assert len(projections) == 1
    assert len(points) == 3


def test_compute_collection_umap_rejects_small_collections(session: Session) -> None:
    """Ensure UMAP computation rejects too few chunks."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)
    document = _create_document(session, collection, user)
    _create_chunks(session, document, collection, embeddings=[[0.0, 1.0], [1.0, 2.0]])

    payload = UmapComputeRequest(n_neighbors=2)
    with pytest.raises(HTTPException) as excinfo:
        visualizations_routes.compute_collection_umap(
            collection.id,
            payload,
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 400


def test_compute_collection_umap_rejects_inconsistent_embeddings(session: Session) -> None:
    """Ensure UMAP computation rejects inconsistent embedding sizes."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)
    document = _create_document(session, collection, user)
    _create_chunks(
        session,
        document,
        collection,
        embeddings=[[0.0, 1.0, 2.0], [1.0, 2.0], [2.0, 3.0, 4.0]],
    )

    payload = UmapComputeRequest(n_neighbors=2)
    with pytest.raises(HTTPException) as excinfo:
        visualizations_routes.compute_collection_umap(
            collection.id,
            payload,
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 400


def test_get_chunk_detail_returns_payload(session: Session) -> None:
    """Ensure chunk detail endpoint returns chunk metadata."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)
    document = _create_document(session, collection, user)
    chunks = _create_chunks(session, document, collection)

    response = documents_routes.get_chunk_detail(
        chunks[0].id,
        current_user=user,
        session=session,
    )

    assert response.chunk.id == chunks[0].id
    assert response.document.id == document.id


def test_get_chunk_detail_rejects_missing(session: Session) -> None:
    """Ensure chunk detail endpoint rejects unknown chunks."""
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        documents_routes.get_chunk_detail(
            UUID(int=0),
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 404


def test_get_chunk_detail_rejects_other_user(session: Session) -> None:
    """Ensure chunk detail endpoint enforces ownership."""
    user = _create_user(session)
    other_user = models.User(
        email="viz-other@example.com",
        full_name="Other User",
        hashed_password="hashed",
    )
    session.add(other_user)
    session.commit()
    session.refresh(other_user)

    collection = _create_collection(session, other_user.id)
    document = _create_document(session, collection, other_user)
    chunks = _create_chunks(session, document, collection)

    with pytest.raises(HTTPException) as excinfo:
        documents_routes.get_chunk_detail(
            chunks[0].id,
            current_user=user,
            session=session,
        )

    assert excinfo.value.status_code == 404
