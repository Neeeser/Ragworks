"""BM25 (lexical) retriever node.

Split from `retrieval.py` (the dense retrievers) purely for module size; the
two share `merge_query_matches` and the same output contract.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.filtering import filter_issues, resolve_filter
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.retrieval import ensure_query_fanout, merge_query_matches
from app.pipelines.nodes.validators import (
    lexical_support_issue,
    missing_index_issue,
    missing_top_k_issue,
)
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.template import namespace_field, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_matches, summarize_text
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.retrieval.models import RetrievalResponse, ScoredChunk
from app.schemas.enums import IndexBackend
from app.schemas.metadata_filter import MetadataFilter
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError, NotFoundError
from app.services.namespace_ownership import resolve_owned_namespace
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, backends_where

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)


class Bm25RetrieverConfig(BaseModel):
    """Configuration for BM25 (sparse/lexical) retriever nodes.

    `top_k` mirrors the dense retriever's contract: required for a runnable
    node, typically the `top_k` variable or an over-retrieval expression.
    """

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend),
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    index_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)
    namespace: str = namespace_field()
    top_k: int | None = Field(
        default=None,
        gt=0,
        description=(
            "How many chunks to fetch — typically the top_k variable, or an "
            "expression like top_k * 2 to over-retrieve for fusion/reranking."
        ),
    )
    filter: MetadataFilter | None = Field(
        default=None,
        description=(
            "Metadata conditions every returned chunk must satisfy. A "
            "condition's value may name a pipeline variable, bound at query "
            "time."
        ),
    )


class Bm25RetrieverNode(PipelineNodeBase[Bm25RetrieverConfig]):
    """Retrieve chunks by lexical (BM25) match on the raw query text.

    Takes the query request directly — no embedding step — so it runs in
    parallel with the embed → dense-retrieve branch and feeds a fusion node.

    Query text is `accepts`, not `requires`: an image query is a stream the
    graph cannot promise text for, and a hard requirement would fail the
    whole run rather than the one branch that has nothing to match on. The
    excluded item leaves this branch contributing zero matches while the
    dense branch serves the image.
    """

    type = "retriever.bm25"
    label = "BM25 Retriever"
    category = "retrieval"
    description = (
        "Query a sparse BM25 index with the raw query text for exact-term "
        "(lexical) matches — no embeddings involved."
    )
    example = "Items(text='error E1042') -> Items(matches=[chunk_a])."
    input_ports = (
        NodePort(
            key="items",
            label="Query",
            data_type=PortKind.ITEMS,
            accepts=(Facet.TEXT,),
            unaccepted="exclude",
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            adds=(Facet.TEXT, Facet.SCORE),
        ),
    )
    config_model = Bm25RetrieverConfig

    @classmethod
    def supported_backends(cls) -> tuple[IndexBackend, ...]:
        """Backends that can serve sparse (BM25) indexes."""
        return backends_where(lambda capabilities: capabilities.supports_lexical)

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate index selection, fetch depth, and the backend's lexical support."""
        config = cls.config_model.model_validate(node.config or {})
        maybe_issues = [
            missing_index_issue(config.index_name, node, "BM25 retriever"),
            missing_top_k_issue(config.top_k, node, "BM25 retriever"),
            lexical_support_issue(
                CAPABILITIES_BY_BACKEND[config.backend], config.backend.value, node
            ),
        ]
        issues = [issue for issue in maybe_issues if issue]
        issues.extend(
            filter_issues(
                config.filter,
                node,
                definition,
                config.backend,
                node_label="BM25 retriever",
            )
        )
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Retrieve lexically matching chunks for every query item and merge."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        if self.config.top_k is None:  # validation blocks this; honest error if reached
            raise InvalidInputError(
                "BM25 retriever node has no top_k configured. Set how many "
                "chunks it fetches (e.g. the top_k variable) in the pipeline editor."
            )

        namespace = resolve_owned_namespace(
            self.config.namespace, context.collection, context.session
        )
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.config.backend)
        metadata_filter = resolve_filter(self.config.filter, context, node_label="BM25 retriever")
        partition = partition_items(batch.items, self.input_ports[0])
        texts = [item.text for item in partition.accepted if item.text is not None]
        ensure_query_fanout(len(texts), "BM25 retriever")
        per_query: list[list[ScoredChunk]] = []
        for text in texts:
            try:
                response = store.lexical_query(
                    index_name,
                    namespace or "",
                    text=text,
                    top_k=self.config.top_k,
                    filter=metadata_filter,
                )
            except NotFoundError:
                # The sparse index is created by the first ingest (ensure_index on
                # the BM25 indexer); querying before then means nothing has been
                # lexically indexed yet — an honest empty branch, not an error.
                logger.info("BM25 index '%s' does not exist yet; returning no matches.", index_name)
                response = RetrievalResponse(matches=[])
            except InvalidInputError as exc:
                # A misconfigured branch (e.g. the name resolves to a dense index)
                # degrades to empty rather than failing the whole fused query.
                logger.warning("BM25 branch on index '%s' skipped: %s", index_name, exc)
                response = RetrievalResponse(matches=[])
            per_query.append(list(response.matches))
        merged = merge_query_matches(per_query) if per_query else []
        logger.info(
            "Pipeline BM25 retrieval returned %s matches for %s query item(s).",
            len(merged),
            len(texts),
        )
        return {"items": ItemBatch.from_matches(merged, usage=batch.usage)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize BM25 retrieval inputs and outputs."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        partition = partition_items(input_batch.items, self.input_ports[0])
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Query",
                    value=summarize_text(input_batch.query_text() or "", 200),
                    kind="text",
                ),
                NodeTraceValue(label="Top K", value=self.config.top_k),
                partition_trace_value(partition, label="Not matched"),
            ],
            outputs=[
                NodeTraceValue(
                    label="Matches", value=summarize_matches(output_batch.preview_matches())
                ),
                NodeTraceValue(
                    label="Match items", value=trace_items(output_batch.items), kind="items"
                ),
            ],
        )
