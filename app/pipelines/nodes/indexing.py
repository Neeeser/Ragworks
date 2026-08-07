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
from app.pipelines.nodes.validators import capability_issues, missing_index_issue
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.template import namespace_field, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_embeddings
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.namespace_ownership import resolve_owned_namespace
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

    index_name: str = Field(
        default_factory=lambda: get_settings().pinecone_index_name,
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    namespace: str = namespace_field()
    dimension: int | None = Field(
        default=None,
        gt=0,
        json_schema_extra=STATIC_ONLY_EXTRA,
        description=(
            "Vector length the index is created with. Must equal the "
            "connected embedding model's output dimension — validation "
            "compares them, and a mismatched index rejects every upsert."
        ),
    )
    metric: str = Field(
        default="cosine",
        json_schema_extra=STATIC_ONLY_EXTRA,
        description=(
            "Distance function the index scores matches with. Match how the "
            "embedding model was trained — cosine for nearly all sentence "
            "embedders; changing it changes what 'similar' means."
        ),
    )
    ensure_index: bool = Field(
        default=True,
        description=(
            "Create the index on first ingest if it does not exist. Disable "
            "to require pre-provisioned indexes — runs fail instead of "
            "creating one."
        ),
    )


class PgvectorIndexerConfig(IndexerConfig):
    """Configuration for pgvector indexing nodes (local default index name)."""

    index_name: str = Field(
        default=DEFAULT_PGVECTOR_INDEX_NAME, json_schema_extra=STATIC_ONLY_EXTRA
    )


class VectorIndexerConfig(IndexerConfig):
    """Unified indexer config: the target backend is data, not a node subtype.

    `index_name` deliberately defaults to empty -- an index must be chosen
    explicitly, and validation flags a blank one (`missing_index_issue`).
    Legacy definitions that relied on the old per-backend defaults get theirs
    filled by the startup migration (`app.pipelines.upgrades`).
    """

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend),
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    index_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)


class BaseIndexerNode(PipelineNodeBase[IndexerConfig]):
    """Shared indexing behavior.

    Legacy subclasses pin a backend as a ClassVar; the unified
    `VectorIndexerNode` leaves it `None` and reads the backend off its
    config (`VectorIndexerConfig.backend`) via `resolve_backend`.
    """

    backend: ClassVar[IndexBackend | None] = None
    category = "ingestion"
    input_ports = (
        NodePort(
            key="items",
            label="Embedded",
            data_type=PortKind.ITEMS,
            accepts=(Facet.EMBEDDING,),
            unaccepted="exclude",
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Indexed",
            data_type=PortKind.ITEMS,
            preserves=True,
        ),
    )
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
    def supported_backends(cls) -> tuple[IndexBackend, ...]:
        """Pinned nodes support their one backend; unified nodes support all."""
        if cls.backend is not None:
            return (cls.backend,)
        return tuple(CAPABILITIES_BY_BACKEND)

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate index config against the backend's declared capabilities.

        The index's width against the embedder feeding it is checked at the
        definition level (`app.pipelines.embedding_dimensions`) — the model's
        published width needs a provider resolver this hook is not given.
        """
        issues: list[PipelineValidationIssue] = []
        indexer_config = cls.config_model.model_validate(node.config or {})
        backend = cls.resolve_backend(indexer_config)
        index_issue = missing_index_issue(indexer_config.index_name, node, "Indexer")
        if index_issue:
            issues.append(index_issue)
        issues.extend(
            capability_issues(
                CAPABILITIES_BY_BACKEND[backend],
                backend_label=backend.value,
                node=node,
                dimension=indexer_config.dimension,
                metric=indexer_config.metric,
            )
        )
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Upsert the embedded part of the stream into the backend's index."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        partition = partition_items(batch.items, self.input_ports[0])
        indexed = ItemBatch(
            items=partition.merge(partition.accepted),
            tokenizer=batch.tokenizer,
            usage=batch.usage,
        )
        if not partition.accepted:
            # Nothing embedded reached this indexer — writing nothing is the
            # honest outcome; the editor's modality analysis is where a graph
            # that can never embed anything is reported.
            return {"items": indexed}
        chunks = [item.to_chunk() for item in partition.accepted]

        dimension = self.config.dimension
        if dimension is None:
            first = chunks[0].embedding
            if first is None:  # unreachable: the port accepts embedded items only
                raise ValueError("Indexer dimension could not be inferred from embeddings.")
            dimension = len(first)
        namespace = resolve_owned_namespace(
            self.config.namespace, context.collection, context.session
        )
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
        return {"items": indexed}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize indexer inputs and outputs."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        partition = partition_items(input_batch.items, self.input_ports[0])
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Embeddings",
                    value=summarize_embeddings(input_batch.preview_chunks()),
                    kind="embedding",
                ),
                NodeTraceValue(
                    label="Embedded items", value=trace_items(input_batch.items), kind="items"
                ),
                partition_trace_value(partition, label="Not indexed"),
            ],
            outputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={
                        "count": len(output_batch.items),
                        "backend": self.resolve_backend(self.config).value,
                    },
                ),
                NodeTraceValue(
                    label="Indexed items", value=trace_items(output_batch.items), kind="items"
                ),
            ],
        )


class VectorIndexerNode(BaseIndexerNode):
    """Upsert embedded chunks into the selected vector-store backend."""

    type = "indexer.vector"
    label = "Indexer"
    description = "Write embeddings into a vector index (pgvector or Pinecone)."
    example = "Items(2 embedded) -> Items(2 embedded, indexed into 'docs')."
    config_model = VectorIndexerConfig
