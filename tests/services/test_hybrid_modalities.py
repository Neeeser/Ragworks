"""The three retrieval modalities, end-to-end at the service layer.

The whole point of the hybrid work is modularity: a collection's pipelines
may index/retrieve semantic + BM25 (the new default), semantic only (also
what deployments without pg_search scaffold), or BM25 only — and all three
must ingest and answer queries. These tests run the real pipelines against
real Postgres with OpenRouter stubbed at the client boundary.
"""

from __future__ import annotations

import io

from sqlmodel import Session

from app.db import models
from app.db.models import DocumentStatus
from app.db.pg_search_support import set_pg_search_available
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.services import ingestion as ingestion_module
from app.services import retrieval as retrieval_module
from app.services.files import FileSystemService, UploadSpec
from app.services.ingestion import IngestionService
from app.services.pipeline_resolution import (
    resolve_ingestion_pipeline,
    resolve_retrieval_pipeline,
)
from app.services.pipelines import PipelineService
from app.services.retrieval import RetrievalService
from app.vectorstores.pgvector import PgvectorStore
from tests.utils.providers import install_default_pipelines

CONTENT = (
    b"Paris is the capital of France.\n\n"
    b"The zephyrblade error code appears when the turbine stalls.\n\n"
    b"Bordeaux is famous for its vineyards and wine."
)


class _StubEmbedder:
    """Embedder stand-in: every text embeds to the same vector, so dense ranking alone can never prefer one chunk — any deterministic reordering must come from BM25."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 5, "total_tokens": 5}

    def embed_documents(self, chunks):
        return [[0.1, 0.2, 0.3] for _ in chunks]

    def embed_query(self, _query: str):
        return [0.1, 0.2, 0.3]


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return _StubEmbedder(model_name)


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="modality@example.com",
        full_name="Modality Tester",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Modalities", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _ingest(
    monkeypatch,
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    chunk_size: int = 16,
) -> models.Document:
    """Upload CONTENT and run the collection's real ingestion pipeline."""
    monkeypatch.setattr(ingestion_module, "ProviderResolver", _StubProviderResolver)
    monkeypatch.setattr(retrieval_module, "ProviderResolver", _StubProviderResolver)
    resolved = resolve_ingestion_pipeline(session, user, collection)
    definition = resolved.definition
    for node in definition.nodes:
        if node.type == "chunker.token":
            node.config = {**node.config, "chunk_size": chunk_size, "chunk_overlap": 0}
    resolved.service.update_pipeline(
        pipeline=resolved.pipeline,
        definition=definition,
        change_summary="Small chunks for modality tests.",
        actor_id=user.id,
    )
    result = FileSystemService(session).register_upload(
        user,
        collection,
        UploadSpec(filename="doc.txt", content_type="text/plain"),
        io.BytesIO(CONTENT),
    )
    assert result.document is not None
    IngestionService(session).ingest_document(
        user=user, collection=collection, document=result.document
    )
    refreshed = session.get(models.Document, result.document.id)
    assert refreshed is not None
    assert refreshed.status == DocumentStatus.READY, refreshed.error_message
    return refreshed


def test_hybrid_default_ingests_both_indexes_and_bm25_drives_ranking(
    monkeypatch, pg_search_session: Session
) -> None:
    """The default hybrid pipeline writes dense + BM25 and fuses retrieval.

    With identical stub embeddings, only the BM25 branch can single out the
    chunk containing the rare term — it must rank first after fusion.
    """
    session = pg_search_session
    user = _create_user(session)
    collection = _create_collection(session, user)
    document = _ingest(monkeypatch, session, user, collection)

    store = PgvectorStore(session)
    assert store.describe_index("ragworks").vector_type == "dense"
    assert store.describe_index("ragworks-bm25").vector_type == "sparse"
    lexical = store.lexical_query(
        "ragworks-bm25", f"col-{collection.id}", text="zephyrblade", top_k=5
    )
    assert lexical.matches, "BM25 index must hold the ingested chunks"

    response = RetrievalService(session).query_collection(
        user, collection, query="zephyrblade", top_k=5
    )

    assert response.chunks, "hybrid retrieval must return fused results"
    assert "zephyrblade" in response.chunks[0].text
    assert document.num_chunks >= len(response.chunks)


def test_semantic_only_defaults_still_work_without_pg_search(
    monkeypatch, pgvector_session: Session
) -> None:
    """With pg_search unavailable, defaults scaffold dense-only and just work."""
    session = pgvector_session
    set_pg_search_available(False)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _ingest(monkeypatch, session, user, collection)

    resolved = resolve_retrieval_pipeline(session, user, collection)
    node_types = {node.type for node in resolved.definition.nodes}
    assert "retriever.bm25" not in node_types
    assert "fusion.rrf" not in node_types
    assert "indexer.bm25" not in {
        node.type
        for node in resolve_ingestion_pipeline(session, user, collection).definition.nodes
    }

    response = RetrievalService(session).query_collection(
        user, collection, query="capital of France", top_k=3
    )

    assert response.chunks
    # Dense-only pipelines keep raw cosine similarity (identical stub vectors).
    assert response.chunks[0].score > 0.99


def test_bm25_only_pipelines_ingest_and_retrieve_without_embeddings(
    monkeypatch, pg_search_session: Session
) -> None:
    """A lexical-only collection needs no embedder anywhere in its pipelines."""
    session = pg_search_session
    user = _create_user(session)
    pipelines = PipelineService(session)
    ingestion = pipelines.create_pipeline(
        user=user,
        name="Lexical Ingestion",
        description="BM25-only ingestion.",
        kind=models.PipelineKind.INGESTION,
        definition=PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(id="in", type="ingestion.input", name="In"),
                PipelineNodeDefinition(id="parse", type="parser.document", name="Parse"),
                PipelineNodeDefinition(
                    id="chunk",
                    type="chunker.token",
                    name="Chunk",
                    config={"chunk_size": 16, "chunk_overlap": 0},
                ),
                PipelineNodeDefinition(
                    id="bm25",
                    type="indexer.bm25",
                    name="BM25 Indexer",
                    config={"backend": "pgvector", "index_name": "lex-only"},
                ),
                PipelineNodeDefinition(id="out", type="ingestion.output", name="Out"),
            ],
            edges=[
                PipelineEdgeDefinition(
                    id="e1", source="in", target="parse",
                    source_port="source", target_port="source",
                ),
                PipelineEdgeDefinition(
                    id="e2", source="parse", target="chunk",
                    source_port="document", target_port="document",
                ),
                PipelineEdgeDefinition(
                    id="e3", source="chunk", target="bm25",
                    source_port="chunks", target_port="chunks",
                ),
                PipelineEdgeDefinition(
                    id="e4", source="bm25", target="out",
                    source_port="indexed", target_port="indexed",
                ),
            ],
        ),
        change_summary="BM25-only ingestion.",
    )
    retrieval = pipelines.create_pipeline(
        user=user,
        name="Lexical Retrieval",
        description="BM25-only retrieval.",
        kind=models.PipelineKind.RETRIEVAL,
        definition=PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(id="in", type="retrieval.input", name="In"),
                PipelineNodeDefinition(
                    id="bm25",
                    type="retriever.bm25",
                    name="BM25 Retriever",
                    config={"backend": "pgvector", "index_name": "lex-only"},
                ),
                PipelineNodeDefinition(id="out", type="retrieval.output", name="Out"),
            ],
            edges=[
                PipelineEdgeDefinition(
                    id="e1", source="in", target="bm25",
                    source_port="request", target_port="request",
                ),
                PipelineEdgeDefinition(
                    id="e2", source="bm25", target="out",
                    source_port="results", target_port="results",
                ),
            ],
        ),
        change_summary="BM25-only retrieval.",
    )
    collection = models.Collection(
        user_id=user.id,
        name="Lexical",
        description="",
        extra_metadata={},
        ingestion_pipeline_id=ingestion.id,
        retrieval_pipeline_id=retrieval.id,
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)

    monkeypatch.setattr(ingestion_module, "ProviderResolver", _FailIfUsedResolver)
    monkeypatch.setattr(retrieval_module, "ProviderResolver", _FailIfUsedResolver)
    result = FileSystemService(session).register_upload(
        user,
        collection,
        UploadSpec(filename="doc.txt", content_type="text/plain"),
        io.BytesIO(CONTENT),
    )
    assert result.document is not None
    IngestionService(session).ingest_document(
        user=user, collection=collection, document=result.document
    )
    refreshed = session.get(models.Document, result.document.id)
    assert refreshed is not None
    assert refreshed.status == DocumentStatus.READY, refreshed.error_message

    response = RetrievalService(session).query_collection(
        user, collection, query="zephyrblade turbine", top_k=5
    )

    assert response.chunks
    assert "zephyrblade" in response.chunks[0].text
    # The settings resolution reports only the sparse target — deleting this
    # collection must not touch any phantom dense index.
    resolved = resolve_ingestion_pipeline(session, user, collection)
    assert [
        (target.vector_type, target.index_name) for target in resolved.settings.index_targets
    ] == [("sparse", "lex-only")]


class _FailIfUsedResolver:
    """A resolver stand-in that fails the test if any embedding happens."""

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    def embedder(self, *_args: object, **_kwargs: object) -> None:
        raise AssertionError("BM25-only pipelines must never resolve an embedder")
