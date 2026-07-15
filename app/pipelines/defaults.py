"""Default pipeline definitions: hybrid (semantic + BM25) ingestion and retrieval.

New defaults scaffold two parallel index paths — chunk text into a sparse
BM25 index alongside the embed → dense-index path — and fuse retrieval
branches with reciprocal rank fusion. On a deployment whose backend can't
serve sparse indexes (external Postgres without pg_search), the BM25 branch
is omitted so defaults always ingest and query successfully.
"""

from __future__ import annotations

from uuid import UUID

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.fusion import RRFusionNode
from app.pipelines.nodes.indexing import (
    BM25_INDEX_SUFFIX,
    Bm25IndexerNode,
    VectorIndexerNode,
    default_index_name,
)
from app.pipelines.nodes.retrieval import Bm25RetrieverNode, VectorRetrieverNode
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError
from app.vectorstores.base import INDEX_NAME_PATTERN
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, lexical_available

# Scaffolds deliberately carry no node positions: layout is owned by the
# frontend's shared auto-layout (`layoutPipelineNodes`), which lays out any
# definition whose nodes lack saved positions on first open. Hand-placing
# coordinates here would duplicate layout knowledge the algorithm owns.

def _default_backend() -> IndexBackend:
    """Return the deployment's configured default index backend."""
    return IndexBackend(get_app_config().indexing.default_backend)


def bm25_sibling_index_name(index_name: str, backend: IndexBackend) -> str:
    """Derive the BM25 index name paired with a dense index name.

    Appends `-bm25`, truncating the base so the result stays within the
    backend's index-name length rule (and never ends on a hyphen).
    """
    max_length = CAPABILITIES_BY_BACKEND[backend].index_name_max_length
    base = index_name[: max_length - len(BM25_INDEX_SUFFIX)].rstrip("-")
    candidate = base + BM25_INDEX_SUFFIX
    if not INDEX_NAME_PATTERN.fullmatch(candidate):
        raise InvalidInputError(f"Cannot derive a BM25 index name from '{index_name}'.")
    return candidate


def build_default_ingestion_pipeline(
    *,
    embedding_connection_id: UUID,
    embedding_model: str,
    backend: IndexBackend | None = None,
    index_name: str | None = None,
    chunk_size: int = 512,
    chunk_overlap: int = 200,
) -> PipelineDefinition:
    """Return the default (hybrid) ingestion pipeline definition.

    There are no global default models: the embedding choice — a provider
    connection plus model — is always explicit (the setup wizard's confirmed
    pick, or an existing default's embedder when re-scaffolding for a backend
    change). Chunks flow down two parallel paths: embed → semantic index, and
    straight into a BM25 index (omitted when the backend can't serve sparse
    indexes).
    """
    backend = backend or _default_backend()
    index_name = index_name or default_index_name(backend)
    include_bm25 = lexical_available(backend)
    nodes = [
        PipelineNodeDefinition(
            id="ingest-input",
            type="ingestion.input",
            name="Ingestion Input",
        ),
        PipelineNodeDefinition(
            id="parse-document",
            type="parser.document",
            name="Document Parser",
        ),
        PipelineNodeDefinition(
            id="chunk-document",
            type="chunker.token",
            name="Token Chunker",
            config={
                "chunk_size": chunk_size,
                "chunk_overlap": chunk_overlap,
            },
        ),
        PipelineNodeDefinition(
            id="embed-chunks",
            type="embedder.text",
            name="Embedder",
config={
                "connection_id": str(embedding_connection_id),
                "model_name": embedding_model,
            },
        ),
        PipelineNodeDefinition(
            id="index-chunks",
            type=VectorIndexerNode.type,
            name="Semantic Indexer",
            config={
                "backend": backend.value,
                "index_name": index_name,
                "namespace": DEFAULT_NAMESPACE_TEMPLATE,
                "metric": "cosine",
                "ensure_index": True,
            },
        ),
        PipelineNodeDefinition(
            id="ingest-output",
            type="ingestion.output",
            name="Ingestion Output",
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
    if include_bm25:
        nodes.append(
            PipelineNodeDefinition(
                id="index-bm25",
                type=Bm25IndexerNode.type,
                name="BM25 Indexer",
                config={
                    "backend": backend.value,
                    "index_name": bm25_sibling_index_name(index_name, backend),
                    "namespace": DEFAULT_NAMESPACE_TEMPLATE,
                    "ensure_index": True,
                },
            )
        )
        edges.extend(
            [
                PipelineEdgeDefinition(
                    id="edge-chunker-bm25-indexer",
                    source="chunk-document",
                    target="index-bm25",
                    source_port="chunks",
                    target_port="chunks",
                ),
                PipelineEdgeDefinition(
                    id="edge-bm25-indexer-output",
                    source="index-bm25",
                    target="ingest-output",
                    source_port="indexed",
                    target_port="indexed",
                ),
            ]
        )
    return PipelineDefinition(nodes=nodes, edges=edges, viewport={})


def build_default_retrieval_pipeline(
    *,
    embedding_connection_id: UUID,
    embedding_model: str,
    backend: IndexBackend | None = None,
    index_name: str | None = None,
) -> PipelineDefinition:
    """Return the default (hybrid) retrieval pipeline definition.

    Same contract as `build_default_ingestion_pipeline`: the embedding choice
    is always explicit. The query runs down two parallel branches — embed →
    semantic retrieve, and BM25 retrieve on the raw text — fused by
    reciprocal rank (the BM25 branch and fusion node are omitted when the
    backend can't serve sparse indexes).
    """
    backend = backend or _default_backend()
    index_name = index_name or default_index_name(backend)
    include_bm25 = lexical_available(backend)
    nodes = [
        PipelineNodeDefinition(
            id="query-input",
            type="retrieval.input",
            name="Retrieval Input",
        ),
        PipelineNodeDefinition(
            id="embed-query",
            type="embedder.text",
            name="Embedder",
config={
                "connection_id": str(embedding_connection_id),
                "model_name": embedding_model,
            },
        ),
        PipelineNodeDefinition(
            id="vector-retriever",
            type=VectorRetrieverNode.type,
            name="Semantic Retriever",
            config={
                "backend": backend.value,
                "index_name": index_name,
                "namespace": DEFAULT_NAMESPACE_TEMPLATE,
            },
        ),
        PipelineNodeDefinition(
            id="retrieval-output",
            type="retrieval.output",
            name="Retrieval Output",
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
    ]
    if include_bm25:
        nodes.extend(
            [
                PipelineNodeDefinition(
                    id="bm25-retriever",
                    type=Bm25RetrieverNode.type,
                    name="BM25 Retriever",
                    config={
                        "backend": backend.value,
                        "index_name": bm25_sibling_index_name(index_name, backend),
                        "namespace": DEFAULT_NAMESPACE_TEMPLATE,
                    },
                ),
                PipelineNodeDefinition(
                    id="fuse-results",
                    type=RRFusionNode.type,
                    name="RRF Fusion",
                ),
            ]
        )
        edges.extend(
            [
                PipelineEdgeDefinition(
                    id="edge-input-bm25-retriever",
                    source="query-input",
                    target="bm25-retriever",
                    source_port="request",
                    target_port="request",
                ),
                PipelineEdgeDefinition(
                    id="edge-semantic-fusion",
                    source="vector-retriever",
                    target="fuse-results",
                    source_port="results",
                    target_port="results",
                ),
                PipelineEdgeDefinition(
                    id="edge-bm25-fusion",
                    source="bm25-retriever",
                    target="fuse-results",
                    source_port="results",
                    target_port="results",
                ),
                PipelineEdgeDefinition(
                    id="edge-fusion-output",
                    source="fuse-results",
                    target="retrieval-output",
                    source_port="results",
                    target_port="results",
                ),
            ]
        )
    else:
        edges.append(
            PipelineEdgeDefinition(
                id="edge-retrieval-output",
                source="vector-retriever",
                target="retrieval-output",
                source_port="results",
                target_port="results",
            )
        )
    return PipelineDefinition(nodes=nodes, edges=edges, viewport={})
