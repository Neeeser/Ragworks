"""Default pipeline definitions mirroring the current ingestion and retrieval flows."""

from __future__ import annotations

from app.core.config import get_settings
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.indexing import DEFAULT_PGVECTOR_INDEX_NAME
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config


def _default_backend() -> IndexBackend:
    """Return the deployment's configured default index backend."""
    return IndexBackend(get_app_config().indexing.default_backend)


def _default_index_name(backend: IndexBackend) -> str:
    """Return the default index name a scaffolded pipeline targets."""
    if backend is IndexBackend.PGVECTOR:
        return DEFAULT_PGVECTOR_INDEX_NAME
    return get_settings().pinecone_index_name


def build_default_ingestion_pipeline() -> PipelineDefinition:
    """Return the default ingestion pipeline definition."""
    backend = _default_backend()
    model_defaults = get_app_config().models
    nodes = [
        PipelineNodeDefinition(
            id="ingest-input",
            type="ingestion.input",
            name="Ingestion Input",
            position={"x": 0, "y": 0},
        ),
        PipelineNodeDefinition(
            id="parse-document",
            type="parser.document",
            name="Document Parser",
            position={"x": 240, "y": 0},
        ),
        PipelineNodeDefinition(
            id="chunk-document",
            type="chunker.token",
            name="Token Chunker",
            position={"x": 480, "y": 0},
            config={
                "chunk_size": 1024,
                "chunk_overlap": 200,
            },
        ),
        PipelineNodeDefinition(
            id="embed-chunks",
            type="embedder.openrouter",
            name="Embedder",
            position={"x": 720, "y": 0},
            config={"model_name": model_defaults.default_embedding_model},
        ),
        PipelineNodeDefinition(
            id="index-chunks",
            type=f"indexer.{backend.value}",
            name="Indexer",
            position={"x": 960, "y": 0},
            config={
                "index_name": _default_index_name(backend),
                "namespace": DEFAULT_NAMESPACE_TEMPLATE,
                "metric": "cosine",
                "ensure_index": True,
            },
        ),
        PipelineNodeDefinition(
            id="ingest-output",
            type="ingestion.output",
            name="Ingestion Output",
            position={"x": 1200, "y": 0},
        ),
    ]
    edges = [
        PipelineEdgeDefinition(
            id="edge-ingest-input-parser",
            source="ingest-input",
            target="parse-document",
            source_port="source",
            target_port="source",
        ),
        PipelineEdgeDefinition(
            id="edge-parser-chunker",
            source="parse-document",
            target="chunk-document",
            source_port="document",
            target_port="document",
        ),
        PipelineEdgeDefinition(
            id="edge-chunker-embedder",
            source="chunk-document",
            target="embed-chunks",
            source_port="chunks",
            target_port="chunks",
        ),
        PipelineEdgeDefinition(
            id="edge-embedder-indexer",
            source="embed-chunks",
            target="index-chunks",
            source_port="embedded",
            target_port="embedded",
        ),
        PipelineEdgeDefinition(
            id="edge-indexer-output",
            source="index-chunks",
            target="ingest-output",
            source_port="indexed",
            target_port="indexed",
        ),
    ]
    return PipelineDefinition(nodes=nodes, edges=edges, viewport={})


def build_default_retrieval_pipeline() -> PipelineDefinition:
    """Return the default retrieval pipeline definition."""
    backend = _default_backend()
    model_defaults = get_app_config().models
    nodes = [
        PipelineNodeDefinition(
            id="query-input",
            type="retrieval.input",
            name="Retrieval Input",
            position={"x": 0, "y": 0},
        ),
        PipelineNodeDefinition(
            id="embed-query",
            type="embedder.openrouter",
            name="Embedder",
            position={"x": 280, "y": 0},
            config={"model_name": model_defaults.default_embedding_model},
        ),
        PipelineNodeDefinition(
            id="vector-retriever",
            type=f"retriever.{backend.value}",
            name="Retriever",
            position={"x": 560, "y": 0},
            config={
                "index_name": _default_index_name(backend),
                "namespace": DEFAULT_NAMESPACE_TEMPLATE,
            },
        ),
        PipelineNodeDefinition(
            id="chat-settings",
            type="chat.settings",
            name="Chat Settings",
            position={"x": 560, "y": 120},
            config={
                "chat_model": model_defaults.default_chat_model,
                "context_window": 8192,
            },
        ),
        PipelineNodeDefinition(
            id="retrieval-output",
            type="retrieval.output",
            name="Retrieval Output",
            position={"x": 840, "y": 0},
        ),
    ]
    edges = [
        PipelineEdgeDefinition(
            id="edge-retrieval-input",
            source="query-input",
            target="embed-query",
            source_port="request",
            target_port="request",
        ),
        PipelineEdgeDefinition(
            id="edge-retrieval-embedder",
            source="embed-query",
            target="vector-retriever",
            source_port="query_embedding",
            target_port="query_embedding",
        ),
        PipelineEdgeDefinition(
            id="edge-retrieval-output",
            source="vector-retriever",
            target="retrieval-output",
            source_port="results",
            target_port="results",
        ),
    ]
    return PipelineDefinition(nodes=nodes, edges=edges, viewport={})
