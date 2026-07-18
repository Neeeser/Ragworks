from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.models import ChunkStrategy
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutor
from app.pipelines.node import PipelineNodeBase
from app.pipelines.nodes.chunking import ChunkerConfig, ChunkerNode
from app.pipelines.payloads import (
    ChunkPayload,
    IndexingPayload,
    ParsedDocumentPayload,
    RetrievalPayload,
    SourcePayload,
    TokenizerSpec,
)
from app.pipelines.ports import NodePort
from app.pipelines.registry import NodeRegistry, build_default_registry
from app.pipelines.resolution import build_environment, resolve_definition
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE
from app.pipelines.tracing.summaries import TokenUsage
from app.retrieval.models import (
    Document,
    DocumentChunk,
    DocumentMetadata,
    RetrievalResponse,
    ScoredChunk,
)
from app.retrieval.parsers.base import DocumentSource
from app.services.errors import ExternalServiceError, InvalidInputError
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
    make_stub_embedder,
)

EMBED_CONNECTION_ID = uuid4()


def _build_context(
    session: Session,
    user: models.User,
    collection: models.Collection,
    *,
    document: models.Document | None = None,
    query: str | None = None,
    top_k: int | None = None,
    storage_path: Path | None = None,
    vector_store: StubVectorStore | None = None,
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
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(vector_store),
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


def _build_document(
    user: models.User, collection: models.Collection, source_path: Path
) -> models.Document:
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


def test_chunker_node_runs_and_summarizes(session: Session) -> None:
    user = _build_user()
    collection = _build_collection(user)
    document = Document(document_id="doc-1", text="alpha beta gamma", metadata=DocumentMetadata())
    payload = ParsedDocumentPayload(document=document)
    node = ChunkerNode(
        ChunkerConfig(
            strategy=ChunkStrategy.TOKEN,
            chunk_size=6,
            chunk_overlap=0,
        )
    )
    outputs = node.run({"document": payload}, _build_context(session, user, collection))
    assert isinstance(outputs.get("chunks"), ChunkPayload)
    summary = node.summarize_io({"document": payload}, outputs)
    assert summary.outputs


def test_pipeline_executor_skips_unreached_branch(session: Session) -> None:
    class _InputNode(PipelineNodeBase):
        type = "test.input"
        label = "Input"
        category = "test"
        description = "Test input"
        example = "Input -> Output."
        input_ports = ()
        output_ports = (NodePort(key="payload", label="Payload", data_type="text"),)

        def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
            return {"payload": "alpha"}

    class _RouterNode(PipelineNodeBase):
        type = "test.router"
        label = "Router"
        category = "test"
        description = "Test router"
        example = "Input -> {alpha: payload}."
        input_ports = (NodePort(key="payload", label="Payload", data_type="text"),)
        output_ports = (
            NodePort(key="alpha", label="Alpha", data_type="text", required=False),
            NodePort(key="beta", label="Beta", data_type="text", required=False),
        )

        def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
            return {"alpha": inputs["payload"]}

    class _SinkNode(PipelineNodeBase):
        type = "test.sink"
        label = "Sink"
        category = "test"
        description = "Test sink"
        example = "Input -> Result."
        input_ports = (NodePort(key="payload", label="Payload", data_type="text"),)
        output_ports = (NodePort(key="result", label="Result", data_type="text"),)

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
    store = StubVectorStore()
    context = _build_context(
        session, user, collection, document=document, storage_path=tmp_path, vector_store=store
    )
    context.providers.embedder_cls = make_stub_embedder(usage={"prompt_tokens": 3})

    definition = build_default_ingestion_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
    )
    executor = PipelineExecutor(build_default_registry())
    result = executor.execute(definition, context)
    payload = next(
        IndexingPayload.model_validate(outputs["result"])
        for outputs in result.terminal_outputs.values()
        if "result" in outputs
    )

    assert payload.chunks
    assert payload.usage == TokenUsage(prompt_tokens=3)
    assert store.ensure_calls
    assert store.upsert_calls


def test_default_retrieval_pipeline_executes(monkeypatch, session: Session) -> None:
    user = _build_user()
    collection = _build_collection(user)
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="chunk",
        order=0,
        metadata=DocumentMetadata(),
    )
    store = StubVectorStore(query_matches=[ScoredChunk(chunk=chunk, score=0.9)])
    context = _build_context(session, user, collection, query="hello", top_k=3, vector_store=store)

    context.providers.embedder_cls = make_stub_embedder(
        usage={"prompt_tokens": 2}, query_result=[0.1, 0.2]
    )

    definition = build_default_retrieval_pipeline(
        embedding_connection_id=EMBED_CONNECTION_ID, embedding_model="test-embed"
    )
    # Resolve-then-run: Result Limit carries an explicit result_limit expression,
    # config, so the executor only ever sees the resolved literal.
    resolved = resolve_definition(
        definition,
        build_environment(definition, query="hello", supplied={"result_limit": 3}),
    )
    executor = PipelineExecutor(build_default_registry())
    result = executor.execute(resolved, context)
    payload = next(
        RetrievalPayload.model_validate(outputs["result"])
        for outputs in result.terminal_outputs.values()
        if "result" in outputs
    )

    assert payload.response.matches
    assert payload.usage == TokenUsage(prompt_tokens=2)
    expected_namespace = DEFAULT_NAMESPACE_TEMPLATE.replace(
        "{collection_id}",
        str(collection.id),
    )
    query_call = store.query_calls[0]
    assert query_call["namespace"] == expected_namespace
    assert query_call["embedding"] == [0.1, 0.2]
    assert query_call["top_k"] == 3


def test_reranker_node_rescores(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.reranking import RerankerConfig, RerankerNode

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

    monkeypatch.setattr("app.pipelines.nodes.reranking.CrossEncoderReranker", _StubReranker)

    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection, query="rerank")
    node = RerankerNode(RerankerConfig(enabled=True))
    outputs = node.run({"results": payload}, context)

    reranked = RetrievalPayload.model_validate(outputs["results"]).response.matches
    assert reranked[0].chunk.chunk_id == "doc:1"


def test_file_type_router_routes_pdf(session: Session) -> None:
    from app.pipelines.nodes.parsing import FileTypeRouterConfig, FileTypeRouterNode

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
    context.providers.embedder_cls = make_stub_embedder(usage={"prompt_tokens": 3})
    outputs = node.run({"source": payload}, context)

    assert "pdf" in outputs


def test_ingestion_input_requires_document(session: Session) -> None:
    from app.pipelines.nodes.io import IngestionInputConfig, IngestionInputNode

    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection, document=None)
    node = IngestionInputNode(IngestionInputConfig())

    with pytest.raises(ValueError, match="missing a document"):
        node.run({}, context)


def test_ingestion_input_requires_source_path(session: Session, tmp_path: Path) -> None:
    from app.pipelines.nodes.io import IngestionInputConfig, IngestionInputNode

    user = _build_user()
    collection = _build_collection(user)
    document = _build_document(user, collection, tmp_path / "doc.txt")
    document.source_path = None
    context = _build_context(session, user, collection, document=document)
    node = IngestionInputNode(IngestionInputConfig())

    with pytest.raises(ValueError, match="source path is not set"):
        node.run({}, context)


def test_ingestion_input_summarizes_the_logical_file_path(session: Session, tmp_path: Path) -> None:
    from app.pipelines.nodes.io import IngestionInputConfig, IngestionInputNode
    from app.pipelines.tracing.summaries import SourceSummary

    user = _build_user()
    session.add(user)
    session.flush()
    collection = _build_collection(user)
    session.add(collection)
    session.flush()
    folder = models.FileNode(
        collection_id=collection.id,
        user_id=user.id,
        parent_id=None,
        kind=models.FileNodeKind.FOLDER,
        name="reports",
    )
    session.add(folder)
    session.flush()
    file = models.FileNode(
        collection_id=collection.id,
        user_id=user.id,
        parent_id=folder.id,
        kind=models.FileNodeKind.FILE,
        name="paper.pdf",
        content_type="application/pdf",
        storage_path=str(tmp_path / "stored-hash"),
    )
    session.add(file)
    session.flush()
    document = _build_document(user, collection, tmp_path / "stored-hash")
    document.file_id = file.id
    document.name = file.name
    document.content_type = file.content_type or "application/octet-stream"
    session.add(document)
    session.commit()

    node = IngestionInputNode(IngestionInputConfig())
    outputs = node.run({}, _build_context(session, user, collection, document=document))
    summary = node.summarize_io({}, outputs)

    source = summary.outputs[0].value
    assert isinstance(source, SourceSummary)
    assert source.path == "/reports/paper.pdf"


def test_document_parser_node_resolves_modes(session: Session) -> None:
    from app.pipelines.nodes.parsing import DocumentParserNode, ParserConfig
    from app.retrieval.parsers.pdf import PdfToTextParser
    from app.retrieval.parsers.txt import TxtDocumentParser

    node = DocumentParserNode(ParserConfig(mode="pdf"))
    assert isinstance(node._resolve_parser("application/pdf"), PdfToTextParser)

    node = DocumentParserNode(ParserConfig(mode="text", encoding="utf-16"))
    assert isinstance(node._resolve_parser("application/pdf"), TxtDocumentParser)

    node = DocumentParserNode(ParserConfig(mode="auto"))
    assert isinstance(node._resolve_parser("application/pdf"), PdfToTextParser)
    assert isinstance(node._resolve_parser("text/plain"), TxtDocumentParser)


def test_file_type_router_routes_text_and_other(session: Session) -> None:
    from app.pipelines.nodes.parsing import FileTypeRouterConfig, FileTypeRouterNode

    node = FileTypeRouterNode(FileTypeRouterConfig())
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)

    text_payload = SourcePayload(
        source=DocumentSource(
            document_id="doc",
            path=Path("/tmp/test.txt"),
            content_type="text/plain",
        )
    )
    outputs = node.run({"source": text_payload}, context)
    assert "text" in outputs

    other_payload = SourcePayload(
        source=DocumentSource(
            document_id="doc",
            path=Path("/tmp/test.bin"),
            content_type="application/octet-stream",
        )
    )
    outputs = node.run({"source": other_payload}, context)
    assert "other" in outputs


def test_file_type_router_summarizes_unknown_route(session: Session) -> None:
    from app.pipelines.nodes.parsing import FileTypeRouterConfig, FileTypeRouterNode

    node = FileTypeRouterNode(FileTypeRouterConfig())

    payload = SourcePayload(
        source=DocumentSource(
            document_id="doc",
            path=Path("/tmp/test.txt"),
            content_type="text/plain",
        )
    )
    summary = node.summarize_io({"source": payload}, {})

    assert summary.outputs[0].value == "unknown"


def test_embedder_node_raises_on_mismatched_embeddings(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
    from app.pipelines.payloads import ChunkPayload
    from app.retrieval.models import Document, DocumentChunk, DocumentMetadata

    document = Document(document_id="doc", text="hello", metadata=DocumentMetadata())
    chunks = [
        DocumentChunk(
            document_id="doc", chunk_id="doc:0", text="a", order=0, metadata=DocumentMetadata()
        ),
        DocumentChunk(
            document_id="doc", chunk_id="doc:1", text="b", order=1, metadata=DocumentMetadata()
        ),
    ]
    payload = ChunkPayload(document=document, chunks=chunks)
    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)
    context.providers.embedder_cls = make_stub_embedder(documents_result=[[0.1, 0.2]])

    with pytest.raises(ValueError, match="mismatched embeddings"):
        node.run({"chunks": payload}, context)


def test_embedder_node_rejects_ambiguous_or_incomplete_inputs(session: Session) -> None:
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode

    user = _build_user()
    context = _build_context(session, user, _build_collection(user))
    payload = ChunkPayload(
        document=Document(document_id="doc", text="", metadata=DocumentMetadata()),
        chunks=[],
    )

    configured = EmbedderNode(
        EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed")
    )
    with pytest.raises(ValueError, match="both chunks and request"):
        configured.run({"chunks": payload, "request": object()}, context)

    with pytest.raises(InvalidInputError, match="needs a provider connection"):
        EmbedderNode(EmbedderConfig()).run({}, context)


def test_embedder_guard_handles_missing_connection_and_zero_effective_limit(
    session: Session,
) -> None:
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
    from app.pipelines.payloads import EmbeddingPayload

    payload = ChunkPayload(
        document=Document(document_id="doc", text="", metadata=DocumentMetadata()),
        chunks=[
            DocumentChunk(
                document_id="doc",
                chunk_id="doc:0",
                text="one two",
                order=0,
                metadata=DocumentMetadata(),
            )
        ],
        tokenizer=TokenizerSpec(kind="whitespace"),
    )
    user = _build_user()
    context = _build_context(session, user, _build_collection(user))
    no_connection = EmbedderNode(EmbedderConfig())
    assert no_connection._guard_embedding_inputs(payload, context) == payload.chunks
    assert no_connection._embedding_input_limit(context) is None

    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    context.providers = StubProviderResolver(embedding_input_limit=16)
    result = node.run({"chunks": payload}, context)
    assert isinstance(result["embedded"], EmbeddingPayload)
    assert len(result["embedded"].chunks) == 1


def test_embedder_node_skips_guard_when_provider_limit_is_unknown() -> None:
    """Unknown provider metadata leaves chunks unchanged and emits no warning."""
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
    from app.pipelines.payloads import EmbeddingPayload

    document = Document(document_id="doc", text="", metadata=DocumentMetadata())
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:9",
        text="one two three four five",
        order=9,
        metadata=DocumentMetadata(data={"page": 1}),
    )
    payload = ChunkPayload(
        document=document,
        chunks=[chunk],
        tokenizer=TokenizerSpec(kind="whitespace"),
    )
    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    user = _build_user()
    collection = _build_collection(user)
    session = Session()
    context = _build_context(session, user, collection)
    context.providers = StubProviderResolver(embedding_input_limit=None)

    result = node.run({"chunks": payload}, context)
    embedded = result["embedded"]
    assert isinstance(embedded, EmbeddingPayload)
    assert [(item.chunk_id, item.order, item.text) for item in embedded.chunks] == [
        ("doc:9", 9, chunk.text)
    ]


def test_embedder_node_skips_guard_when_limit_lookup_is_unavailable() -> None:
    """Provider metadata outages do not prevent the embedding call."""
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode

    class _UnavailableLimitResolver(StubProviderResolver):
        def embedding_input_limit(self, _connection_id: object, _model_name: str) -> int | None:
            raise ExternalServiceError("model metadata unavailable")

    payload = ChunkPayload(
        document=Document(document_id="doc", text="", metadata=DocumentMetadata()),
        chunks=[
            DocumentChunk(
                document_id="doc",
                chunk_id="doc:0",
                text="one two three",
                order=0,
                metadata=DocumentMetadata(),
            )
        ],
        tokenizer=TokenizerSpec(kind="whitespace"),
    )
    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    user = _build_user()
    context = _build_context(Session(), user, _build_collection(user))
    context.providers = _UnavailableLimitResolver()

    result = node.run({"chunks": payload}, context)

    assert result["embedded"]


def test_embedder_node_requires_a_mode(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode

    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)
    context.providers.embedder_cls = make_stub_embedder()

    with pytest.raises(ValueError, match="requires a chunk batch or query request"):
        node.run({}, context)


def test_embedder_node_summarizes_chunk_mode(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
    from app.pipelines.payloads import ChunkPayload
    from app.retrieval.models import Document, DocumentChunk, DocumentMetadata

    document = Document(document_id="doc", text="hello", metadata=DocumentMetadata())
    chunks = [
        DocumentChunk(
            document_id="doc", chunk_id="doc:0", text="a", order=0, metadata=DocumentMetadata()
        ),
    ]
    payload = ChunkPayload(document=document, chunks=chunks)
    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)
    context.providers.embedder_cls = make_stub_embedder(usage={"prompt_tokens": 1})

    outputs = node.run({"chunks": payload}, context)
    summary = node.summarize_io({"chunks": payload}, outputs)

    assert summary.inputs
    assert summary.outputs


def test_embedder_node_summarizes_query_mode(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
    from app.pipelines.payloads import RetrievalRequestPayload
    from app.retrieval.models import QueryRequest

    payload = RetrievalRequestPayload(request=QueryRequest(text="hello", top_k=3))
    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)
    context.providers.embedder_cls = make_stub_embedder(usage={"prompt_tokens": 1})

    outputs = node.run({"request": payload}, context)
    summary = node.summarize_io({"request": payload}, outputs)

    assert summary.inputs
    assert summary.outputs


def test_embedder_node_embeds_query(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
    from app.pipelines.payloads import QueryEmbeddingPayload, RetrievalRequestPayload
    from app.retrieval.models import QueryRequest

    payload = RetrievalRequestPayload(request=QueryRequest(text="hello", top_k=3))
    node = EmbedderNode(EmbedderConfig(connection_id=EMBED_CONNECTION_ID, model_name="test-embed"))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)
    context.providers.embedder_cls = make_stub_embedder(
        usage={"prompt_tokens": 4}, query_result=[0.1, 0.2, 0.3]
    )

    outputs = node.run({"request": payload}, context)
    result = QueryEmbeddingPayload.model_validate(outputs["query_embedding"])

    assert result.embedding == [0.1, 0.2, 0.3]
    assert result.request.text == "hello"
    assert result.usage == TokenUsage(prompt_tokens=4)


def test_indexer_node_requires_dimension(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.indexing import IndexerConfig
    from app.pipelines.nodes.indexing_legacy import IndexerNode
    from app.pipelines.payloads import EmbeddingPayload
    from app.retrieval.models import Document, DocumentChunk, DocumentMetadata

    document = Document(document_id="doc", text="hello", metadata=DocumentMetadata())
    chunks = [
        DocumentChunk(
            document_id="doc", chunk_id="doc:0", text="a", order=0, metadata=DocumentMetadata()
        ),
    ]
    payload = EmbeddingPayload(document=document, chunks=chunks, usage={})
    node = IndexerNode(IndexerConfig(dimension=None))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection)

    with pytest.raises(ValueError, match="dimension could not be inferred"):
        node.run({"embedded": payload}, context)


def test_indexer_node_skips_ensure_index(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.indexing import IndexerConfig
    from app.pipelines.nodes.indexing_legacy import IndexerNode
    from app.pipelines.payloads import EmbeddingPayload
    from app.retrieval.models import Document, DocumentChunk, DocumentMetadata

    document = Document(document_id="doc", text="hello", metadata=DocumentMetadata())
    chunks = [
        DocumentChunk(
            document_id="doc",
            chunk_id="doc:0",
            text="a",
            order=0,
            metadata=DocumentMetadata(),
            embedding=[0.1, 0.2],
        ),
    ]
    payload = EmbeddingPayload(document=document, chunks=chunks, usage={})
    node = IndexerNode(IndexerConfig(dimension=None, ensure_index=False))
    user = _build_user()
    collection = _build_collection(user)
    store = StubVectorStore()
    context = _build_context(session, user, collection, vector_store=store)

    node.run({"embedded": payload}, context)

    assert store.ensure_calls == []
    assert len(store.upsert_calls) == 1


def test_indexer_node_infers_dimension(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.indexing import IndexerConfig
    from app.pipelines.nodes.indexing_legacy import IndexerNode
    from app.pipelines.payloads import EmbeddingPayload
    from app.retrieval.models import Document, DocumentChunk, DocumentMetadata

    document = Document(document_id="doc", text="hello", metadata=DocumentMetadata())
    chunks = [
        DocumentChunk(
            document_id="doc",
            chunk_id="doc:0",
            text="a",
            order=0,
            metadata=DocumentMetadata(),
            embedding=[0.1, 0.2, 0.3],
        ),
    ]
    payload = EmbeddingPayload(document=document, chunks=chunks, usage={})
    node = IndexerNode(IndexerConfig(dimension=None))
    user = _build_user()
    collection = _build_collection(user)
    store = StubVectorStore()
    context = _build_context(session, user, collection, vector_store=store)

    node.run({"embedded": payload}, context)

    assert store.ensure_calls[0].dimension == 3


def test_indexer_node_uses_configured_dimension(monkeypatch, session: Session) -> None:
    from app.pipelines.nodes.indexing import IndexerConfig
    from app.pipelines.nodes.indexing_legacy import IndexerNode
    from app.pipelines.payloads import EmbeddingPayload
    from app.retrieval.models import Document, DocumentChunk, DocumentMetadata

    document = Document(document_id="doc", text="hello", metadata=DocumentMetadata())
    chunks = [
        DocumentChunk(
            document_id="doc",
            chunk_id="doc:0",
            text="a",
            order=0,
            metadata=DocumentMetadata(),
            embedding=[0.1, 0.2, 0.3],
        ),
    ]
    payload = EmbeddingPayload(document=document, chunks=chunks, usage={})
    node = IndexerNode(IndexerConfig(dimension=8))
    user = _build_user()
    collection = _build_collection(user)
    store = StubVectorStore()
    context = _build_context(session, user, collection, vector_store=store)

    node.run({"embedded": payload}, context)

    assert store.ensure_calls[0].dimension == 8


def test_retrieval_input_requires_query(session: Session) -> None:
    from app.pipelines.nodes.io import RetrievalInputConfig, RetrievalInputNode

    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection, query=None)
    node = RetrievalInputNode(RetrievalInputConfig())

    with pytest.raises(ValueError, match="missing a query string"):
        node.run({}, context)


def test_reranker_node_returns_when_disabled(session: Session) -> None:
    from app.pipelines.nodes.reranking import RerankerConfig, RerankerNode
    from app.pipelines.payloads import RetrievalPayload
    from app.retrieval.models import DocumentChunk, DocumentMetadata, RetrievalResponse, ScoredChunk

    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="alpha",
        order=0,
        metadata=DocumentMetadata(),
    )
    payload = RetrievalPayload(
        response=RetrievalResponse(matches=[ScoredChunk(chunk=chunk, score=0.5)]), usage={}
    )
    node = RerankerNode(RerankerConfig(enabled=False))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection, query="hi")

    outputs = node.run({"results": payload}, context)

    assert outputs["results"].response.matches[0].chunk.chunk_id == "doc:0"


def test_reranker_node_requires_query(session: Session) -> None:
    from app.pipelines.nodes.reranking import RerankerConfig, RerankerNode
    from app.pipelines.payloads import RetrievalPayload
    from app.retrieval.models import DocumentChunk, DocumentMetadata, RetrievalResponse, ScoredChunk

    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="alpha",
        order=0,
        metadata=DocumentMetadata(),
    )
    payload = RetrievalPayload(
        response=RetrievalResponse(matches=[ScoredChunk(chunk=chunk, score=0.5)]), usage={}
    )
    node = RerankerNode(RerankerConfig(enabled=True))
    user = _build_user()
    collection = _build_collection(user)
    context = _build_context(session, user, collection, query=None)

    with pytest.raises(ValueError, match="requires a query string"):
        node.run({"results": payload}, context)


def test_reranker_node_summarize_io(session: Session) -> None:
    from app.pipelines.nodes.reranking import RerankerConfig, RerankerNode
    from app.pipelines.payloads import RetrievalPayload
    from app.retrieval.models import DocumentChunk, DocumentMetadata, RetrievalResponse, ScoredChunk

    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="alpha",
        order=0,
        metadata=DocumentMetadata(),
    )
    payload = RetrievalPayload(
        response=RetrievalResponse(matches=[ScoredChunk(chunk=chunk, score=0.5)]), usage={}
    )
    node = RerankerNode(RerankerConfig(enabled=True))

    summary = node.summarize_io({"results": payload}, {"results": payload})

    assert summary.inputs
    assert summary.outputs
