from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.api.config import get_settings
from app.db import models
from app.db.models import ChunkStrategy
from app.pipelines.defaults import build_default_ingestion_pipeline, build_default_retrieval_pipeline
from app.pipelines.models import PipelineDefinition, PipelineEdgeDefinition, PipelineNodeDefinition
from app.pipelines.payloads import IndexingPayload, RetrievalPayload, SourcePayload
from app.pipelines.registry import build_default_registry
from app.pipelines.runtime import (
    NodePort,
    NodeRegistry,
    PipelineExecutor,
    PipelineNodeBase,
    PipelineRunContext,
)
from app.retrieval.models import DocumentChunk, DocumentMetadata, RetrievalResponse, ScoredChunk
from app.retrieval.parsers.base import DocumentSource
from app.utils.file_storage import FileStorage


def _build_context(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    document: models.Document | None = None,
    query: str | None = None,
    top_k: int | None = None,
    storage_path: Path | None = None,
) -> PipelineRunContext:
    settings = get_settings()
    storage = FileStorage(base_path=storage_path) if storage_path else FileStorage()
    return PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=document,
        query=query,
        top_k=top_k,
        openrouter=object(),
        pinecone=object(),
        storage=storage,
        settings=settings,
    )


def _build_user() -> models.User:
    return models.User(
        id=uuid4(),
        email="pipeline@test.local",
        hashed_password="hashed",
    )


def _build_collection(user: models.User) -> models.Collection:
    return models.Collection(
        id=uuid4(),
        user_id=user.id,
        name="Pipeline Collection",
        description="",
        extra_metadata={},
    )


def _build_document(user: models.User, collection: models.Collection, source_path: Path) -> models.Document:
    return models.Document(
        id=uuid4(),
        collection_id=collection.id,
        user_id=user.id,
        name=source_path.name,
        content_type="text/plain",
        status=models.DocumentStatus.PROCESSING,
        chunk_size=4,
        chunk_overlap=1,
        chunk_strategy=ChunkStrategy.TOKEN,
        embedding_model="embed-model",
        source_path=str(source_path),
    )


def test_pipeline_registry_specs_include_examples() -> None:
    registry = build_default_registry()
    specs = registry.specs()
    assert specs
    for spec in specs:
        assert spec.description
        assert spec.example
        if spec.input_ports and spec.output_ports:
            assert "->" in spec.example


def test_pipeline_executor_skips_unreached_branch(session: Session) -> None:
    class _InputNode(PipelineNodeBase):
        type = "test.input"
        label = "Input"
        category = "test"
        description = "Test input"
        example = "Input -> Output."
        input_ports = []
        output_ports = [NodePort(key="payload", label="Payload", data_type="text")]

        def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
            return {"payload": "alpha"}

    class _RouterNode(PipelineNodeBase):
        type = "test.router"
        label = "Router"
        category = "test"
        description = "Test router"
        example = "Input -> {alpha: payload}."
        input_ports = [NodePort(key="payload", label="Payload", data_type="text")]
        output_ports = [
            NodePort(key="alpha", label="Alpha", data_type="text", required=False),
            NodePort(key="beta", label="Beta", data_type="text", required=False),
        ]

        def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
            return {"alpha": inputs["payload"]}

    class _SinkNode(PipelineNodeBase):
        type = "test.sink"
        label = "Sink"
        category = "test"
        description = "Test sink"
        example = "Input -> Result."
        input_ports = [NodePort(key="payload", label="Payload", data_type="text")]
        output_ports = [NodePort(key="result", label="Result", data_type="text")]

        def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
            return {"result": inputs["payload"]}

    registry = NodeRegistry([_InputNode, _RouterNode, _SinkNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.input", name="Input"),
            PipelineNodeDefinition(id="router", type="test.router", name="Router"),
            PipelineNodeDefinition(id="sink-alpha", type="test.sink", name="Sink Alpha"),
            PipelineNodeDefinition(id="sink-beta", type="test.sink", name="Sink Beta"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-input-router",
                source="input",
                target="router",
                source_port="payload",
                target_port="payload",
            ),
            PipelineEdgeDefinition(
                id="edge-router-alpha",
                source="router",
                target="sink-alpha",
                source_port="alpha",
                target_port="payload",
            ),
            PipelineEdgeDefinition(
                id="edge-router-beta",
                source="router",
                target="sink-beta",
                source_port="beta",
                target_port="payload",
            ),
        ],
    )

    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)
    executor = PipelineExecutor(registry)
    result = executor.execute(definition, context)

    assert "sink-alpha" in result.outputs_by_node
    assert "sink-beta" not in result.outputs_by_node


def test_default_ingestion_pipeline_executes(monkeypatch, session: Session, tmp_path: Path) -> None:
    source_path = tmp_path / "sample.txt"
    source_path.write_text("alpha beta gamma delta", encoding="utf-8")

    user = _build_user()
    collection = _build_collection(user)
    document = _build_document(user, collection, source_path)
    context = _build_context(session, user, collection, document=document, storage_path=tmp_path)

    class _StubEmbedder:
        usage = {"prompt_tokens": 3}

        def __init__(self, _client: object, _model_name: str) -> None:
            pass

        def embed_documents(self, chunks: list[DocumentChunk]) -> list[list[float]]:
            return [[0.1, 0.2] for _ in chunks]

    @dataclass
    class _IndexerState:
        upsert_calls: list[dict[str, Any]]

    state = _IndexerState(upsert_calls=[])

    class _StubIndexer:
        def __init__(self, client: object) -> None:
            self.client = client

        def ensure_index(self, config: object) -> None:
            state.upsert_calls.append({"config": config, "ensure": True})

        def upsert(self, config: object, chunks: list[DocumentChunk], namespace: str | None = None) -> None:
            state.upsert_calls.append(
                {"config": config, "chunks": chunks, "namespace": namespace}
            )

    monkeypatch.setattr("app.pipelines.nodes.ingestion.OpenRouterEmbedder", _StubEmbedder)
    monkeypatch.setattr("app.pipelines.nodes.ingestion.PineconeIndexer", _StubIndexer)

    definition = build_default_ingestion_pipeline()
    executor = PipelineExecutor(build_default_registry())
    result = executor.execute(definition, context)
    payload = next(
        IndexingPayload.model_validate(outputs["result"])
        for outputs in result.terminal_outputs.values()
        if "result" in outputs
    )

    assert payload.chunks
    assert payload.usage == {"prompt_tokens": 3}
    assert state.upsert_calls


def test_default_retrieval_pipeline_executes(monkeypatch, session: Session) -> None:
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection, query="hello", top_k=3)

    class _StubEmbedder:
        usage = {"prompt_tokens": 2}

        def __init__(self, _client: object, _model_name: str) -> None:
            pass

        def embed_query(self, _query: str) -> list[float]:
            return [0.1, 0.2]

    class _StubRetriever:
        def __init__(self, index_config: object, embedder: object, client: object) -> None:
            self.index_config = index_config
            self.embedder = embedder

        def retrieve(self, request: object) -> RetrievalResponse:
            chunk = DocumentChunk(
                document_id="doc",
                chunk_id="doc:0",
                text="chunk",
                order=0,
                metadata=DocumentMetadata(),
            )
            scored = ScoredChunk(chunk=chunk, score=0.9)
            return RetrievalResponse(matches=[scored])

    monkeypatch.setattr("app.pipelines.nodes.retrieval.OpenRouterEmbedder", _StubEmbedder)
    monkeypatch.setattr("app.pipelines.nodes.retrieval.PineconeRetriever", _StubRetriever)

    definition = build_default_retrieval_pipeline()
    executor = PipelineExecutor(build_default_registry())
    result = executor.execute(definition, context)
    payload = next(
        RetrievalPayload.model_validate(outputs["result"])
        for outputs in result.terminal_outputs.values()
        if "result" in outputs
    )

    assert payload.response.matches
    assert payload.usage == {"prompt_tokens": 2}


def test_reranker_node_rescores(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.retrieval import RerankerConfig, RerankerNode

    chunk_a = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="alpha",
        order=0,
        metadata=DocumentMetadata(),
    )
    chunk_b = DocumentChunk(
        document_id="doc",
        chunk_id="doc:1",
        text="beta",
        order=1,
        metadata=DocumentMetadata(),
    )
    payload = RetrievalPayload(
        response=RetrievalResponse(
            matches=[
                ScoredChunk(chunk=chunk_a, score=0.1),
                ScoredChunk(chunk=chunk_b, score=0.2),
            ]
        ),
        usage={},
    )

    class _StubReranker:
        def __init__(self, model_name: str, **_kwargs: object) -> None:
            self.model_name = model_name

        def rerank(self, query: str, candidates: list[ScoredChunk], top_k: int | None = None):
            return list(reversed(candidates))

    monkeypatch.setattr("app.pipelines.nodes.retrieval.CrossEncoderReranker", _StubReranker)

    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection, query="rerank")
    node = RerankerNode(RerankerConfig(enabled=True))
    outputs = node.run({"results": payload}, context)

    reranked = RetrievalPayload.model_validate(outputs["results"]).response.matches
    assert reranked[0].chunk.chunk_id == "doc:1"


def test_file_type_router_routes_pdf(session: Session) -> None:
    from app.pipelines.nodes.ingestion import FileTypeRouterNode, FileTypeRouterConfig

    source = DocumentSource(
        document_id="doc",
        path=Path("/tmp/test.pdf"),
        content_type="application/pdf",
    )
    payload = SourcePayload(source=source)
    node = FileTypeRouterNode(FileTypeRouterConfig())
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)
    outputs = node.run({"source": payload}, context)

    assert "pdf" in outputs
