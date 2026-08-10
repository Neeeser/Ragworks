"""BM25 (sparse/lexical) indexing node.

Split from the dense indexer for the same reason `retrieval_bm25.py` is
split from `retrieval.py`: the lexical path shares no config shape, no
capability checks, and no dimension arithmetic with the dense one.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.validators import lexical_support_issue, missing_index_issue
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.template import namespace_field, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.namespace_ownership import resolve_owned_namespace
from app.vectorstores.base import IndexSpec
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, backends_where

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry


class Bm25IndexerConfig(BaseModel):
    """Configuration for BM25 (sparse/lexical) indexing nodes.

    No dimension or metric: sparse indexes are text-scored (pg_search BM25 /
    Pinecone's integrated sparse model). `index_name` defaults to empty like
    the unified dense indexer — an index must be chosen explicitly.
    """

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend),
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    index_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)
    namespace: str = namespace_field()
    ensure_index: bool = True


class Bm25IndexerNode(PipelineNodeBase[Bm25IndexerConfig]):
    """Index chunk text into a sparse (BM25) index for lexical search.

    Reads the same item stream the embedder does — the lexical path needs no
    embeddings, so it runs in parallel with the embed → dense-index branch.
    Lexical scoring is defined over text, so the node accepts text items
    and excludes the rest; a stream carrying images indexes its text here
    and its images wherever the graph sends them.
    """

    type = "indexer.bm25"
    label = "BM25 Indexer"
    category = "ingestion"
    description = (
        "Write chunk text into a sparse BM25 index for exact-term (lexical) "
        "search — no embeddings involved."
    )
    example = "Items(2 chunks) -> Items(2 chunks, indexed into 'docs-bm25')."
    input_ports = (
        NodePort(
            key="items",
            label="Chunks",
            data_type=PortKind.ITEMS,
            accepts=(Facet.TEXT,),
            unaccepted="exclude",
        ),
    )
    output_ports = (
        NodePort(key="items", label="Indexed", data_type=PortKind.ITEMS, preserves=True),
    )
    config_model = Bm25IndexerConfig

    @classmethod
    def supported_backends(cls) -> tuple[IndexBackend, ...]:
        """Backends that can serve sparse (BM25) indexes."""
        return backends_where(lambda capabilities: capabilities.supports_lexical)

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
        index_issue = missing_index_issue(config.index_name, node, "BM25 indexer")
        if index_issue:
            issues.append(index_issue)
        support_issue = lexical_support_issue(
            CAPABILITIES_BY_BACKEND[config.backend], config.backend.value, node
        )
        if support_issue:
            issues.append(support_issue)
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Upsert the textual part of the stream into the backend's sparse index."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        partition = partition_items(batch.items, self.input_ports[0])
        indexed = ItemBatch(
            items=partition.merge(partition.accepted),
            tokenizer=batch.tokenizer,
            usage=batch.usage,
        )
        if not partition.accepted:
            return {"items": indexed}
        chunks = [item.to_chunk() for item in partition.accepted]
        namespace = resolve_owned_namespace(
            self.config.namespace, context.collection, context.session
        )
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.config.backend)
        if self.config.ensure_index:
            store.ensure_index(IndexSpec(name=index_name, vector_type="sparse"))
        batch_size = store.capabilities.max_lexical_upsert_batch
        for start in range(0, len(chunks), batch_size):
            store.upsert_lexical(index_name, namespace or "", chunks[start : start + batch_size])
        return {"items": indexed}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize BM25 indexer inputs and outputs."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        partition = partition_items(input_batch.items, self.input_ports[0])
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Chunks",
                    value={"count": len(input_batch.items)},
                ),
                NodeTraceValue(
                    label="Chunk items", value=trace_items(input_batch.items), kind="items"
                ),
                partition_trace_value(partition, label="Not indexed"),
            ],
            outputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={
                        "count": len(output_batch.items),
                        "backend": self.config.backend.value,
                        "index_type": "bm25",
                    },
                ),
                NodeTraceValue(
                    label="Indexed items", value=trace_items(output_batch.items), kind="items"
                ),
            ],
        )
