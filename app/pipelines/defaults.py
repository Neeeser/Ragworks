"""The hybrid (semantic + BM25) ingestion and retrieval graphs.

Both scaffold two parallel index paths — chunk text into a sparse BM25 index
alongside the embed → dense-index path — and fuse retrieval branches with
reciprocal rank fusion. On a deployment whose backend can't serve sparse
indexes (external Postgres without pg_search), the BM25 branch is omitted so
the graphs still ingest and query successfully.

The first-run setup wizard installs both; the create-pipeline wizard offers
the retrieval one as a template (`app/pipelines/tool_defaults.py`).
"""

from __future__ import annotations

from uuid import UUID

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.nodes.chunking import (
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_SIZE,
    clamp_chunk_window,
)
from app.pipelines.nodes.fusion import RRFusionNode
from app.pipelines.nodes.indexing import (
    BM25_INDEX_SUFFIX,
    VectorIndexerNode,
    default_index_name,
)
from app.pipelines.nodes.indexing_bm25 import Bm25IndexerNode
from app.pipelines.nodes.limiting import ResultLimitNode
from app.pipelines.nodes.parsing import ParseTextNode
from app.pipelines.nodes.retrieval import VectorRetrieverNode
from app.pipelines.nodes.retrieval_bm25 import Bm25RetrieverNode
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE
from app.pipelines.variables import PipelineVariable, VariableSource, VariableType
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError
from app.vectorstores.base import INDEX_NAME_PATTERN
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, lexical_available

# Scaffolds deliberately carry no node positions: layout is owned by the
# frontend's shared auto-layout (`layoutPipelineNodes`), which lays out any
# definition whose nodes lack saved positions on first open. Hand-placing
# coordinates here would duplicate layout knowledge the algorithm owns.

# The historical tool contract as an input variable: definitions own the
# declaration; the retrieval.input node just accepts it by name.
DEFAULT_RESULT_LIMIT_VARIABLE = PipelineVariable(
    name="result_limit",
    type=VariableType.INTEGER,
    source=VariableSource.INPUT,
    description="Maximum number of results to return.",
    value=5,
    minimum=1,
    maximum=10,
    expose_to_llm=True,
)


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


def build_default_ingestion_pipeline(  # noqa: PLR0913
    *,
    embedding_connection_id: UUID,
    embedding_model: str,
    backend: IndexBackend | None = None,
    index_name: str | None = None,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
    embedding_input_limit: int | None = None,
) -> PipelineDefinition:
    """Return the hybrid ingestion pipeline definition.

    There are no global default models: the embedding choice — a provider
    connection plus model — is always the caller's, so scaffolding can never
    build a graph around a model nobody picked. Chunks flow down two parallel
    paths: embed → semantic index, and straight into a BM25 index (omitted
    when the backend can't serve sparse indexes).
    """
    backend = backend or _default_backend()
    index_name = index_name or default_index_name(backend)
    include_bm25 = lexical_available(backend)
    chunk_size, chunk_overlap = clamp_chunk_window(chunk_size, chunk_overlap, embedding_input_limit)
    nodes = [
        PipelineNodeDefinition(
            id="ingest-input",
            type="ingestion.input",
            name="Ingestion Input",
        ),
        PipelineNodeDefinition(
            id="parse-text",
            type=ParseTextNode.type,
            name="Extract Text",
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
            target="parse-text",
            source_port="items",
            target_port="source",
        ),
        PipelineEdgeDefinition(
            id="edge-parser-chunker",
            source="parse-text",
            target="chunk-document",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="edge-chunker-embedder",
            source="chunk-document",
            target="embed-chunks",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="edge-embedder-indexer",
            source="embed-chunks",
            target="index-chunks",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="edge-indexer-output",
            source="index-chunks",
            target="ingest-output",
            source_port="items",
            target_port="items",
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
                    source_port="items",
                    target_port="items",
                ),
                PipelineEdgeDefinition(
                    id="edge-bm25-indexer-output",
                    source="index-bm25",
                    target="ingest-output",
                    source_port="items",
                    target_port="items",
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
    """Return the hybrid retrieval pipeline definition.

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
            # The definition owns the caller-facing result limit. The external
            # query API's top_k field is translated at the runner boundary.
            config={
                "arguments": [DEFAULT_RESULT_LIMIT_VARIABLE.name],
                "tool_name": "search",
                "tool_description": "Search the collection for relevant document chunks.",
            },
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
            # Fetch depth is always explicit — the declared result limit,
            # never an invisible request fallback.
            config={
                "backend": backend.value,
                "index_name": index_name,
                "namespace": DEFAULT_NAMESPACE_TEMPLATE,
                "top_k": {"$expr": DEFAULT_RESULT_LIMIT_VARIABLE.name},
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
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="edge-retrieval-embedder",
            source="embed-query",
            target="vector-retriever",
            source_port="items",
            target_port="items",
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
                        "top_k": {"$expr": DEFAULT_RESULT_LIMIT_VARIABLE.name},
                    },
                ),
                PipelineNodeDefinition(
                    id="fuse-results",
                    type=RRFusionNode.type,
                    name="RRF Fusion",
                ),
                # Fusion never cuts; Result Limit is the explicit final cap.
                PipelineNodeDefinition(
                    id="limit-results",
                    type=ResultLimitNode.type,
                    name="Result Limit",
                    config={"max_results": {"$expr": DEFAULT_RESULT_LIMIT_VARIABLE.name}},
                ),
            ]
        )
        edges.extend(
            [
                PipelineEdgeDefinition(
                    id="edge-input-bm25-retriever",
                    source="query-input",
                    target="bm25-retriever",
                    source_port="items",
                    target_port="items",
                ),
                PipelineEdgeDefinition(
                    id="edge-semantic-fusion",
                    source="vector-retriever",
                    target="fuse-results",
                    source_port="items",
                    target_port="items",
                ),
                PipelineEdgeDefinition(
                    id="edge-bm25-fusion",
                    source="bm25-retriever",
                    target="fuse-results",
                    source_port="items",
                    target_port="items",
                ),
                PipelineEdgeDefinition(
                    id="edge-fusion-limit",
                    source="fuse-results",
                    target="limit-results",
                    source_port="items",
                    target_port="items",
                ),
                PipelineEdgeDefinition(
                    id="edge-limit-output",
                    source="limit-results",
                    target="retrieval-output",
                    source_port="items",
                    target_port="items",
                ),
            ]
        )
    else:
        edges.append(
            PipelineEdgeDefinition(
                id="edge-retrieval-output",
                source="vector-retriever",
                target="retrieval-output",
                source_port="items",
                target_port="items",
            )
        )
    return PipelineDefinition(
        nodes=nodes,
        edges=edges,
        viewport={},
        variables=[DEFAULT_RESULT_LIMIT_VARIABLE.model_copy(deep=True)],
    )
