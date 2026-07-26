"""Tests for visualization and chunk detail routes."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.routes import documents as documents_routes
from app.api.routes import visualizations as visualizations_routes
from app.db import models
from app.schemas.visualization import UmapComputeRequest
from app.visualization.umap import service as umap_service
from app.visualization.umap.repository import SNIPPET_CHARS, ChunkEmbeddingRow, build_snippet


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


def _fake_chunk_rows(embeddings: list[list[float] | None]) -> list[ChunkEmbeddingRow]:
    """Build chunk rows without persisting database records."""
    rows: list[ChunkEmbeddingRow] = []
    for index, embedding in enumerate(embeddings):
        rows.append(
            ChunkEmbeddingRow(
                chunk_id=uuid4(),
                document_id=uuid4(),
                chunk_index=index,
                embedding=embedding,
                embedding_model="test-embed",
            )
        )
    return rows


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


def test_umap_points_carry_their_source_document_name_and_snippet(session: Session) -> None:
    """Ensure every point names the document it came from and excerpts its chunk.

    The plot colours points by source document and names them on hover, so a
    payload carrying only ids would force one request per document before the
    plane could say anything about itself.
    """
    user = _create_user(session)
    collection = _create_collection(session, user.id)
    document = _create_document(session, collection, user)
    _create_chunks(session, document, collection)

    payload = UmapComputeRequest(n_neighbors=2, min_dist=0.0, random_state=1)
    computed = visualizations_routes.compute_collection_umap(
        collection.id,
        payload,
        current_user=user,
        session=session,
    )

    assert {point.document_name for point in computed.points} == {"Visualization Doc"}
    assert sorted(point.text_snippet for point in computed.points) == [
        "Chunk 0",
        "Chunk 1",
        "Chunk 2",
    ]

    # A stored projection and a freshly computed one must be identical on the
    # wire, or the plot would label differently depending on which call ran.
    fetched = visualizations_routes.get_collection_umap(
        collection.id,
        current_user=user,
        session=session,
    )
    assert [point.model_dump() for point in fetched.points] == [
        point.model_dump() for point in computed.points
    ]


def test_umap_point_snippet_collapses_whitespace_and_clips_long_chunks(
    session: Session,
) -> None:
    """Ensure a long, multi-line chunk reaches the plot as one clipped line."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)
    document = _create_document(session, collection, user)
    chunks = _create_chunks(session, document, collection)
    chunks[0].text = "Ragworks\n\n   indexes    documents.\n" + ("padding " * 60)
    session.add(chunks[0])
    session.commit()

    payload = UmapComputeRequest(n_neighbors=2, min_dist=0.0, random_state=1)
    response = visualizations_routes.compute_collection_umap(
        collection.id,
        payload,
        current_user=user,
        session=session,
    )

    snippet = next(
        point.text_snippet for point in response.points if point.chunk_id == chunks[0].id
    )
    assert snippet.startswith("Ragworks indexes documents. padding")
    assert "\n" in chunks[0].text
    assert "\n" not in snippet
    assert snippet.endswith("…")
    assert len(snippet) <= SNIPPET_CHARS + 1


def test_build_snippet_leaves_a_chunk_that_fits_unclipped() -> None:
    """Ensure an exact-fit chunk keeps every character and gains no ellipsis."""
    text = "x" * SNIPPET_CHARS

    assert build_snippet(text, len(text)) == text
    assert build_snippet(text + "y", len(text) + 1).endswith("…")


def test_build_snippet_marks_a_chunk_whose_whitespace_collapses_under_the_limit() -> None:
    """Ensure text left out is always signalled, even when collapsing shrinks it.

    An indented chunk collapses well below the limit, so a length test on the
    fetched window alone reports the excerpt as the whole chunk.
    """
    window = "word" + "    " * 200
    total = len(window) + 500

    assert build_snippet(window, total) == "word…"
    assert build_snippet(window, len(window)) == "word"


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


def test_compute_collection_umap_rejects_missing_embeddings(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ensure UMAP computation rejects missing embeddings."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)

    rows = _fake_chunk_rows([[0.0, 1.0], None, [1.0, 2.0]])
    monkeypatch.setattr(
        umap_service.UmapRepository,
        "list_chunk_embeddings",
        lambda _self, _collection_id: rows,
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


def test_compute_collection_umap_rejects_empty_embeddings(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ensure UMAP computation rejects empty embeddings."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)

    rows = _fake_chunk_rows([[], [], []])
    monkeypatch.setattr(
        umap_service.UmapRepository,
        "list_chunk_embeddings",
        lambda _self, _collection_id: rows,
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


def test_compute_collection_umap_rejects_nonfinite_coordinates(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ensure UMAP computation rejects non-finite coordinates."""
    user = _create_user(session)
    collection = _create_collection(session, user.id)

    rows = _fake_chunk_rows([[0.0, 1.0], [1.0, 2.0], [2.0, 3.0]])
    monkeypatch.setattr(
        umap_service.UmapRepository,
        "list_chunk_embeddings",
        lambda _self, _collection_id: rows,
    )

    class _StubUmap:
        def __init__(self, **_kwargs) -> None:
            pass

        def fit_transform(self, _array):
            return [[0.0, 0.0], [float("nan"), 1.0], [1.0, 2.0]]

    monkeypatch.setattr(umap_service, "UMAP", _StubUmap)

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
