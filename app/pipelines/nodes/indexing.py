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
from app.pipelines.nodes.embedding import EmbedderConfig
from app.pipelines.nodes.validators import capability_issues, missing_index_issue
from app.pipelines.payloads import EmbeddingPayload, IndexingPayload
from app.pipelines.ports import NodePort
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_embeddings
from app.schemas.enums import IndexBackend
from app.vectorstores.base import IndexSpec
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry

# Default logical index name for pgvector-backed pipelines (the Pinecone
# nodes default to `settings.pinecone_index_name` instead).
DEFAULT_PGVECTOR_INDEX_NAME = "ragworks"


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
    """Shared indexing behavior; subclasses bind a vector-store backend."""

    backend: ClassVar[IndexBackend]
    category = "ingestion"
    input_ports = (NodePort(key="embedded", label="Embedded", data_type="embedded_batch"),)
    output_ports = (NodePort(key="indexed", label="Indexed", data_type="indexed_batch"),)
    # Narrowed from the base's `type[BaseModel]` so validation reads typed fields.
    config_model: builtins.type[IndexerConfig] = IndexerConfig

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
        index_issue = missing_index_issue(indexer_config.index_name, node.id, "Indexer")
        if index_issue:
            issues.append(index_issue)
        issues.extend(
            capability_issues(
                CAPABILITIES_BY_BACKEND[cls.backend],
                backend_label=cls.backend.value,
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
            if not source_def or source_def.type != "embedder.openrouter":
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

        store = context.vector_stores.get(self.backend)
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
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={"count": len(output_payload.chunks), "backend": self.backend.value},
                )
            ],
        )


class IndexerNode(BaseIndexerNode):
    """Upsert embedded chunks into Pinecone."""

    backend: ClassVar[IndexBackend] = IndexBackend.PINECONE
    type = "indexer.pinecone"
    label = "Pinecone Indexer"
    description = "Upsert embeddings into Pinecone."
    example = "EmbeddingPayload(chunks=2) -> IndexingPayload(chunks=2, index='pinecone')."


class PgvectorIndexerNode(BaseIndexerNode):
    """Upsert embedded chunks into pgvector (the app's own Postgres)."""

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    type = "indexer.pgvector"
    label = "pgvector Indexer"
    description = "Upsert embeddings into the built-in Postgres (pgvector)."
    example = "EmbeddingPayload(chunks=2) -> IndexingPayload(chunks=2, index='pgvector')."
    config_model = PgvectorIndexerConfig
