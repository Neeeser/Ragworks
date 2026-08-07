"""An image query through the query-side nodes and the default hybrid graph.

The query item carries `text=None` when the request supplied only an image,
so every query-side node that reads text has to partition rather than
demand it. These tests pin that at the node level (the BM25 branch) and
through a whole default retrieval run, which is the graph a user actually
queries.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlmodel import Session, select

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.runner import PipelineRunner
from app.pipelines.nodes.retrieval_bm25 import Bm25RetrieverConfig, Bm25RetrieverNode
from app.pipelines.payloads import Item, ItemBatch, MediaAsset, RetrievalPayload
from app.retrieval.models import DocumentChunk, DocumentMetadata, ScoredChunk
from app.schemas.enums import IndexBackend
from app.services.pipelines import DEFAULT_SEARCH_SLUG, PipelineService
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
)
from tests.utils.providers import install_default_pipelines

ASSETS = Path(__file__).parent.parent / "assets"
QUERY_IMAGE = "collections/c/queries/deadbeef.png"


class _MultimodalEmbedder:
    """Embedder stand-in whose model reads text and images alike."""

    def __init__(self, _client: object, model_name: str, dimensions: int | None = None) -> None:
        self.model_name = model_name
        self.dimensions = dimensions

    @property
    def usage(self) -> dict[str, int] | None:
        return None

    def embed_documents(self, chunks: Any) -> list[list[float]]:
        return [[0.1, 0.2] for _ in chunks]

    def embed_query(self, _query: str) -> list[float]:
        return [0.1, 0.2]

    def embed_images(self, images: Any) -> list[list[float]]:
        return [[0.9, 0.8] for _ in images]


def _match(chunk_id: str, score: float) -> ScoredChunk:
    return ScoredChunk(
        chunk=DocumentChunk(
            document_id="doc",
            chunk_id=chunk_id,
            text=f"text of {chunk_id}",
            order=0,
            metadata=DocumentMetadata(),
        ),
        score=score,
    )


def _asset() -> MediaAsset:
    return MediaAsset(
        media_type="image/png", path=QUERY_IMAGE, byte_size=1883, width=8, height=8
    )


def _node_context(session: Session, store: StubVectorStore) -> PipelineRunContext:
    return PipelineRunContext(
        session=session,
        user=models.User(id=uuid4(), email="imgq@test.local", hashed_password="hashed"),
        collection=models.Collection(
            id=uuid4(), user_id=uuid4(), name="C", description="", extra_metadata={}
        ),
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(store),
        storage=FileStorage(),
        settings=get_settings(),
    )


class TestBm25BranchOnAnImageQuery:
    """The lexical branch excludes an item it cannot match on."""

    def test_an_image_only_query_matches_nothing_and_queries_nothing(
        self, session: Session
    ) -> None:
        store = StubVectorStore(lexical_matches=[_match("chunk-a", 0.9)])
        node = Bm25RetrieverNode(
            Bm25RetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs", top_k=5)
        )
        batch = ItemBatch(items=[Item(id="query", image=_asset())])

        outputs = node.run({"items": batch}, _node_context(session, store))

        assert ItemBatch.model_validate(outputs["items"]).items == []
        # The branch never reached the store: there was nothing to match on.
        assert store.lexical_query_calls == []

    def test_a_text_query_still_reaches_the_store(self, session: Session) -> None:
        store = StubVectorStore(lexical_matches=[_match("chunk-a", 0.9)])
        node = Bm25RetrieverNode(
            Bm25RetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs", top_k=5)
        )
        batch = ItemBatch(items=[Item(id="query", text="aurora", image=_asset())])

        outputs = node.run({"items": batch}, _node_context(session, store))

        assert [call["text"] for call in store.lexical_query_calls] == ["aurora"]
        assert [item.id for item in ItemBatch.model_validate(outputs["items"]).items] == [
            "chunk-a"
        ]

    def test_the_trace_names_what_the_branch_skipped(self, session: Session) -> None:
        store = StubVectorStore()
        node = Bm25RetrieverNode(
            Bm25RetrieverConfig(backend=IndexBackend.PGVECTOR, index_name="docs", top_k=5)
        )
        batch = ItemBatch(items=[Item(id="query", image=_asset())])
        outputs = node.run({"items": batch}, _node_context(session, store))

        summary = node.summarize_io({"items": batch}, outputs)

        skipped = next(value for value in summary.inputs if value.label == "Not matched")
        assert skipped.value == {"count": 1, "facets": {"image": 1}}


def _run_default_retrieval(
    session: Session,
    tmp_path: Path,
    *,
    query: str,
    query_media: MediaAsset | None,
    store: StubVectorStore,
) -> RetrievalPayload:
    """Execute the shipped hybrid retrieval pipeline for one query."""
    user = models.User(email=f"hybrid-{uuid4().hex}@test.local", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    collection = models.Collection(
        user_id=user.id, name="Hybrid", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)

    service = PipelineService(session)
    pipeline = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == DEFAULT_SEARCH_SLUG,
        )
    ).one()
    definition = PipelineDefinition.model_validate(
        service.get_current_version(pipeline).definition
    )

    runner = PipelineRunner(session)
    handle = runner.start(
        pipeline=pipeline,
        version=service.get_current_version(pipeline),
        definition=definition,
        trigger=models.BindingRole.TOOL,
        user=user,
        collection=collection,
        settings=get_settings(),
        providers=StubProviderResolver(
            _MultimodalEmbedder, published_modalities=frozenset({"text", "image"})
        ),
        vector_stores=StubVectorStoreProvider(store),
        storage=FileStorage(base_path=tmp_path),
        query=query,
        query_media=query_media,
        top_k=5,
    )
    result = runner.execute(handle)
    return next(
        RetrievalPayload.model_validate(outputs["result"])
        for outputs in result.terminal_outputs.values()
        if "result" in outputs
    )


class TestDefaultHybridPipelineServesAnImageQuery:
    """The shipped hybrid graph runs an image-only query to completion."""

    def test_the_dense_branch_answers_and_the_lexical_branch_stays_empty(
        self, session: Session, tmp_path: Path
    ) -> None:
        FileStorage(base_path=tmp_path).write_bytes(
            (ASSETS / "diagram.png").read_bytes(), QUERY_IMAGE
        )
        store = StubVectorStore(
            query_matches=[_match("dense-hit", 0.8)],
            lexical_matches=[_match("lexical-hit", 0.7)],
        )

        payload = _run_default_retrieval(
            session, tmp_path, query="", query_media=_asset(), store=store
        )

        # The image was embedded and retrieved on; the BM25 branch had no
        # text to match, so the fused result is the dense branch alone.
        assert [call["embedding"] for call in store.query_calls] == [[0.9, 0.8]]
        assert store.lexical_query_calls == []
        assert [match.chunk.chunk_id for match in payload.response.matches] == ["dense-hit"]

    def test_a_text_query_still_fuses_both_branches(
        self, session: Session, tmp_path: Path
    ) -> None:
        store = StubVectorStore(
            query_matches=[_match("dense-hit", 0.8)],
            lexical_matches=[_match("lexical-hit", 0.7)],
        )

        payload = _run_default_retrieval(
            session, tmp_path, query="aurora", query_media=None, store=store
        )

        assert [call["text"] for call in store.lexical_query_calls] == ["aurora"]
        assert {match.chunk.chunk_id for match in payload.response.matches} == {
            "dense-hit",
            "lexical-hit",
        }
