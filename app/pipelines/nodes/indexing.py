"""Indexer nodes: upsert embedded chunks into a vector-store backend.

One shared base owns the run/summarize/validation logic; each backend
subclass declares only its type id, backend, and labels (the chunker
fixed-strategy pattern). Capability limits (max dimension, metrics, batch
size) are read off the backend's `VectorStoreCapabilities` — never
re-hardcoded here.
"""

from __future__ import annotations

import builtins
from typing import TYPE_CHECKING, ClassVar

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.nodes.validators import (
    capability_issues,
    lexical_support_issue,
    missing_index_issue,
)
from app.pipelines.payloads import ChunkPayload, EmbeddingPayload, IndexingPayload
from app.pipelines.ports import NodePort
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_embeddings, trace_chunk_items
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.vectorstores.base import IndexSpec
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry

# Default logical index name for pgvector-backed pipelines (the Pinecone
# nodes default to `settings.pinecone_index_name` instead).
DEFAULT_PGVECTOR_INDEX_NAME = "ragworks"

# Suffix distinguishing a pipeline's sparse (BM25) index from its dense
# sibling (e.g. `ragworks` + `ragworks-bm25`).
BM25_INDEX_SUFFIX = "-bm25"


def default_index_name(backend: IndexBackend) -> str:
    """Return the default dense index name a pipeline targets on a backend."""
    if backend is IndexBackend.PGVECTOR:
        return DEFAULT_PGVECTOR_INDEX_NAME
    return get_settings().pinecone_index_name


class IndexerConfig(BaseModel):
    """Configuration for Pinecone indexing nodes."""

    index_name: str = Field(default_factory=lambda: get_settings().pinecone_index_name)
    namespace: str = Field(default=DEFAULT_NAMESPACE_TEMPLATE)
    dimension: int | None = Field(default=None, gt=0)
    metric: str = "cosine"
    ensure_index: bool = True


class PgvectorIndexerConfig(IndexerConfig):
    """Configuration for pgvector indexing nodes (local default index name)."""

    index_name: str = Field(default=DEFAULT_PGVECTOR_INDEX_NAME)


class VectorIndexerConfig(IndexerConfig):
    """Unified indexer config: the target backend is data, not a node subtype.

    `index_name` deliberately defaults to empty -- an index must be chosen
    explicitly, and validation flags a blank one (`missing_index_issue`).
    Legacy definitions that relied on the old per-backend defaults get theirs
    filled by the startup migration (`app.pipelines.upgrades`).
    """

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend)
    )
    index_name: str = ""


def _dimension_issue(
    embedder_dim: int | None,
    indexer_dim: int | None,
    ids: tuple[str, str],
) -> PipelineValidationIssue | None:
    """Flag an embedder/indexer dimension mismatch or missing configuration.

    `ids` is `(indexer_node_id, embedder_node_id)`.
    """
    indexer_id, embedder_id = ids
    if embedder_dim and indexer_dim and embedder_dim != indexer_dim:
        return PipelineValidationIssue(
            message=(
                f"Indexer node '{indexer_id}' dimension {indexer_dim} does not "
                f"match embedder '{embedder_id}' dimension {embedder_dim}."
            ),
            severity="error",
        )
    if embedder_dim and not indexer_dim:
        return PipelineValidationIssue(
            message=(
                f"Indexer node '{indexer_id}' has no dimension configured; ensure it "
                f"matches embedder '{embedder_id}' dimension {embedder_dim}."
            ),
            severity="warning",
        )
    if indexer_dim and not embedder_dim:
        return PipelineValidationIssue(
            message=(
                f"Embedder node '{embedder_id}' has no dimension configured; "
                f"ensure it matches indexer '{indexer_id}' dimension {indexer_dim}."
            ),
            severity="warning",
        )
    return None


class BaseIndexerNode(PipelineNodeBase[IndexerConfig]):
    """Shared indexing behavior.

    Legacy subclasses pin a backend as a ClassVar; the unified
    `VectorIndexerNode` leaves it `None` and reads the backend off its
    config (`VectorIndexerConfig.backend`) via `resolve_backend`.
    """

    backend: ClassVar[IndexBackend | None] = None
    category = "ingestion"
    input_ports = (NodePort(key="embedded", label="Embedded", data_type="embedded_batch"),)
    output_ports = (NodePort(key="indexed", label="Indexed", data_type="indexed_batch"),)
    # Narrowed from the base's `type[BaseModel]` so validation reads typed fields.
    config_model: builtins.type[IndexerConfig] = IndexerConfig

    @classmethod
    def resolve_backend(cls, config: IndexerConfig) -> IndexBackend:
        """Return the backend this node writes to: class-pinned or config-selected."""
        if cls.backend is not None:
            return cls.backend
        if isinstance(config, VectorIndexerConfig):
            return config.backend
        raise ValueError(f"Node type '{cls.type}' does not declare a vector-store backend.")

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate index config against backend capabilities and the embedder."""
        issues: list[PipelineValidationIssue] = []
        indexer_config = cls.config_model.model_validate(node.config or {})
        backend = cls.resolve_backend(indexer_config)
        index_issue = missing_index_issue(indexer_config.index_name, node.id, "Indexer")
        if index_issue:
            issues.append(index_issue)
        issues.extend(
            capability_issues(
                CAPABILITIES_BY_BACKEND[backend],
                backend_label=backend.value,
                node_id=node.id,
                dimension=indexer_config.dimension,
                metric=indexer_config.metric,
            )
        )
        incoming_edges = definition.incoming_edges().get(node.id, [])
        if not incoming_edges:
            return issues
        node_map = definition.node_map()
        for edge in incoming_edges:
            source_def = node_map.get(edge.source)
            if not source_def or source_def.type != EmbedderNode.type:
                continue
            embedder_config = EmbedderConfig.model_validate(source_def.config or {})
            issue = _dimension_issue(
                embedder_config.dimension,
                indexer_config.dimension,
                (node.id, source_def.id),
            )
            if issue:
                issues.append(issue)
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Upsert embedded chunks into the backend's index."""
        payload = EmbeddingPayload.model_validate(inputs.get("embedded"))
        document = payload.document
        chunks = payload.chunks

        dimension = self.config.dimension
        if dimension is None:
            if not chunks or chunks[0].embedding is None:
                raise ValueError("Indexer dimension could not be inferred from embeddings.")
            dimension = len(chunks[0].embedding)
        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.resolve_backend(self.config))
        spec = IndexSpec(name=index_name, dimension=int(dimension), metric=self.config.metric)
        if self.config.ensure_index:
            store.ensure_index(spec)
        batch_size = store.capabilities.max_upsert_batch
        for start in range(0, len(chunks), batch_size):
            store.upsert(index_name, namespace or "", chunks[start : start + batch_size])
        return {
            "indexed": IndexingPayload(
                document=document,
                chunks=chunks,
                usage=payload.usage,
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize indexer inputs and outputs."""
        input_payload = EmbeddingPayload.model_validate(inputs.get("embedded"))
        output_payload = IndexingPayload.model_validate(outputs.get("indexed"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Embeddings",
                    value=summarize_embeddings(input_payload.chunks),
                    kind="embedding",
                ),
                NodeTraceValue(label="Embedded items", value=trace_chunk_items(input_payload.chunks), kind="items"),
            ],
            outputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={
                        "count": len(output_payload.chunks),
                        "backend": self.resolve_backend(self.config).value,
                    },
                ),
                NodeTraceValue(label="Indexed items", value=trace_chunk_items(output_payload.chunks), kind="items"),
            ],
        )


class VectorIndexerNode(BaseIndexerNode):
    """Upsert embedded chunks into the selected vector-store backend."""

    type = "indexer.vector"
    label = "Indexer"
    description = "Write embeddings into a vector index (pgvector or Pinecone)."
    example = "EmbeddingPayload(chunks=2) -> IndexingPayload(chunks=2, index='docs')."
    config_model = VectorIndexerConfig


class Bm25IndexerConfig(BaseModel):
    """Configuration for BM25 (sparse/lexical) indexing nodes.

    No dimension or metric: sparse indexes are text-scored (pg_search BM25 /
    Pinecone's integrated sparse model). `index_name` defaults to empty like
    the unified dense indexer — an index must be chosen explicitly.
    """

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend)
    )
    index_name: str = ""
    namespace: str = Field(default=DEFAULT_NAMESPACE_TEMPLATE)
    ensure_index: bool = True


class Bm25IndexerNode(PipelineNodeBase[Bm25IndexerConfig]):
    """Index chunk text into a sparse (BM25) index for lexical search.

    Taps the chunker's output directly — the lexical path never needs
    embeddings, so it runs in parallel with the embed → dense-index branch.
    """

    type = "indexer.bm25"
    label = "BM25 Indexer"
    category = "ingestion"
    description = (
        "Write chunk text into a sparse BM25 index for exact-term (lexical) "
        "search — no embeddings involved."
    )
    example = "ChunkPayload(chunks=2) -> IndexingPayload(chunks=2, index='docs-bm25')."
    input_ports = (NodePort(key="chunks", label="Chunks", data_type="chunk_batch"),)
    output_ports = (NodePort(key="indexed", label="Indexed", data_type="indexed_batch"),)
    config_model = Bm25IndexerConfig

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate index selection and the backend's lexical support."""
        config = cls.config_model.model_validate(node.config or {})
        issues: list[PipelineValidationIssue] = []
        index_issue = missing_index_issue(config.index_name, node.id, "BM25 indexer")
        if index_issue:
            issues.append(index_issue)
        support_issue = lexical_support_issue(
            CAPABILITIES_BY_BACKEND[config.backend], config.backend.value, node.id
        )
        if support_issue:
            issues.append(support_issue)
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Upsert chunk texts into the backend's sparse index."""
        payload = ChunkPayload.model_validate(inputs.get("chunks"))
        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.config.backend)
        if self.config.ensure_index:
            store.ensure_index(IndexSpec(name=index_name, vector_type="sparse"))
        batch_size = store.capabilities.max_lexical_upsert_batch
        chunks = payload.chunks
        for start in range(0, len(chunks), batch_size):
            store.upsert_lexical(index_name, namespace or "", chunks[start : start + batch_size])
        return {"indexed": IndexingPayload(document=payload.document, chunks=chunks)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize BM25 indexer inputs and outputs."""
        input_payload = ChunkPayload.model_validate(inputs.get("chunks"))
        output_payload = IndexingPayload.model_validate(outputs.get("indexed"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Chunks",
                    value={"count": len(input_payload.chunks)},
                ),
                NodeTraceValue(
                    label="Chunk items", value=trace_chunk_items(input_payload.chunks), kind="items"
                ),
            ],
            outputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={
                        "count": len(output_payload.chunks),
                        "backend": self.config.backend.value,
                        "index_type": "bm25",
                    },
                ),
                NodeTraceValue(
                    label="Indexed items", value=trace_chunk_items(output_payload.chunks), kind="items"
                ),
            ],
        )


class IndexerNode(BaseIndexerNode):
    """Deprecated Pinecone-pinned indexer; new pipelines use `indexer.vector`.

    Kept registered because node type ids are permanent -- persisted pipeline
    versions may still reference it -- but hidden from the editor catalog.
    """

    backend: ClassVar[IndexBackend] = IndexBackend.PINECONE
    type = "indexer.pinecone"
    label = "Pinecone Indexer"
    description = "Upsert embeddings into Pinecone."
    example = "EmbeddingPayload(chunks=2) -> IndexingPayload(chunks=2, index='pinecone')."
    hidden = True


class PgvectorIndexerNode(BaseIndexerNode):
    """Deprecated pgvector-pinned indexer; new pipelines use `indexer.vector`.

    Kept registered because node type ids are permanent -- persisted pipeline
    versions may still reference it -- but hidden from the editor catalog.
    """

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    type = "indexer.pgvector"
    label = "pgvector Indexer"
    description = "Upsert embeddings into the built-in Postgres (pgvector)."
    example = "EmbeddingPayload(chunks=2) -> IndexingPayload(chunks=2, index='pgvector')."
    config_model = PgvectorIndexerConfig
    hidden = True
