"""Aggregate tool nodes: lexical-match facts instead of fetched chunks (#133).

"How many documents mention X" (count) and "which sources mention X" (facet)
are different query shapes from ranked retrieval, answered by index
aggregates rather than a top-k fetch. Both feed `tool.output`, whose merged
values become the tool's structured result.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.validators import (
    lexical_count_support_issue,
    lexical_facet_support_issue,
    missing_index_issue,
)
from app.pipelines.payloads import (
    RetrievalRequestPayload,
    StructuredValuesPayload,
    dump_outputs,
)
from app.pipelines.ports import NodePort
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_text
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError, NotFoundError
from app.vectorstores.base import FacetBucket
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND, backends_where

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)


class Bm25CountConfig(BaseModel):
    """Configuration for the BM25 count node.

    Index identity mirrors the BM25 retriever (backend, sparse index name,
    namespace template); all identity fields are static-only so purge
    coverage never depends on caller input.
    """

    backend: IndexBackend = Field(
        default=IndexBackend.PGVECTOR, json_schema_extra=STATIC_ONLY_EXTRA
    )
    index_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)
    namespace: str = Field(
        default=DEFAULT_NAMESPACE_TEMPLATE, json_schema_extra=STATIC_ONLY_EXTRA
    )


class Bm25CountNode(PipelineNodeBase[Bm25CountConfig]):
    """Count documents/chunks whose text lexically matches the query."""

    type = "count.bm25"
    label = "BM25 Count"
    category = "tools"
    description = (
        "Count how many documents and chunks lexically match the query text "
        "in a sparse BM25 index — an aggregate, not a top-k fetch."
    )
    example = (
        "QueryRequest(text='aurora') -> "
        "StructuredValues(matching_documents=2, matching_chunks=3)."
    )
    input_ports = (NodePort(key="request", label="Request", data_type="query_request"),)
    output_ports = (
        NodePort(key="values", label="Values", data_type="structured_values"),
    )
    config_model = Bm25CountConfig

    @classmethod
    def supported_backends(cls) -> tuple[IndexBackend, ...]:
        """Backends that can count lexical matches (ParadeDB/pgvector today)."""
        return backends_where(lambda capabilities: capabilities.supports_lexical_count)

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate index selection and the backend's lexical-count support."""
        config = cls.config_model.model_validate(node.config or {})
        maybe_issues = [
            missing_index_issue(config.index_name, node.id, "BM25 count"),
            lexical_count_support_issue(
                CAPABILITIES_BY_BACKEND[config.backend], config.backend.value, node.id
            ),
        ]
        return [issue for issue in maybe_issues if issue]

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Count lexical matches for the query request."""
        payload = RetrievalRequestPayload.model_validate(inputs.get("request"))
        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.config.backend)
        try:
            result = store.lexical_count(
                index_name, namespace or "", text=payload.request.text
            )
            documents, chunks = result.matching_documents, result.matching_chunks
        except NotFoundError:
            # Mirrors the retriever contract: a not-yet-created index holds
            # nothing — an honest zero, not an error.
            logger.info("BM25 index '%s' does not exist yet; counting zero.", index_name)
            documents, chunks = 0, 0
        except InvalidInputError as exc:
            # A misconfigured target (e.g. the name resolves to a dense index)
            # degrades to zero rather than failing the tool run.
            logger.warning("BM25 count on index '%s' skipped: %s", index_name, exc)
            documents, chunks = 0, 0
        return {
            "values": StructuredValuesPayload(
                values={"matching_documents": documents, "matching_chunks": chunks}
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the counted query and its counts."""
        request = RetrievalRequestPayload.model_validate(inputs.get("request")).request
        values = StructuredValuesPayload.model_validate(outputs.get("values")).values
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Query", value=summarize_text(request.text, 200), kind="text"
                ),
            ],
            outputs=[NodeTraceValue(label="Counts", value=dict(values))],
        )


class Bm25FacetConfig(BaseModel):
    """Configuration for the BM25 facet node.

    Index identity mirrors the count node (backend, sparse index name,
    namespace template; all static-only for purge coverage). `field` names
    the chunk-metadata key to group matches by — ingestion stamps `filename`
    and `path` on every chunk, so `filename` is the useful default; `top_n`
    caps how many buckets the tool returns.
    """

    backend: IndexBackend = Field(
        default=IndexBackend.PGVECTOR, json_schema_extra=STATIC_ONLY_EXTRA
    )
    index_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)
    namespace: str = Field(
        default=DEFAULT_NAMESPACE_TEMPLATE, json_schema_extra=STATIC_ONLY_EXTRA
    )
    field: str = Field(
        default="filename",
        min_length=1,
        description="Chunk-metadata key to group matches by (e.g. filename).",
    )
    top_n: int = Field(
        default=10,
        ge=1,
        le=100,
        description="Maximum number of facet buckets to return.",
    )


class Bm25FacetNode(PipelineNodeBase[Bm25FacetConfig]):
    """Group lexically matching chunks by a metadata field, with counts."""

    type = "facet.bm25"
    label = "BM25 Facet"
    category = "tools"
    description = (
        "Group the chunks lexically matching the query by a metadata field "
        "(filename by default), counting documents and chunks per value."
    )
    example = (
        "QueryRequest(text='aurora') -> StructuredValues(facets=[('alpha.md', 2 chunks), "
        "('beta.md', 1 chunk)])."
    )
    input_ports = (NodePort(key="request", label="Request", data_type="query_request"),)
    output_ports = (
        NodePort(key="values", label="Values", data_type="structured_values"),
    )
    config_model = Bm25FacetConfig

    @classmethod
    def supported_backends(cls) -> tuple[IndexBackend, ...]:
        """Backends that can facet lexical matches (ParadeDB/pgvector today)."""
        return backends_where(lambda capabilities: capabilities.supports_lexical_facet)

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate index selection and the backend's lexical-facet support."""
        config = cls.config_model.model_validate(node.config or {})
        maybe_issues = [
            missing_index_issue(config.index_name, node.id, "BM25 facet"),
            lexical_facet_support_issue(
                CAPABILITIES_BY_BACKEND[config.backend], config.backend.value, node.id
            ),
        ]
        return [issue for issue in maybe_issues if issue]

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Facet lexical matches for the query request."""
        payload = RetrievalRequestPayload.model_validate(inputs.get("request"))
        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.config.backend)
        buckets: list[FacetBucket]
        try:
            buckets = store.lexical_facet(
                index_name,
                namespace or "",
                text=payload.request.text,
                field=self.config.field,
                top_n=self.config.top_n,
            )
        except NotFoundError:
            # Mirrors the count/retriever contract: a not-yet-created index
            # holds nothing — an honest empty facet list, not an error.
            logger.info("BM25 index '%s' does not exist yet; faceting nothing.", index_name)
            buckets = []
        except InvalidInputError as exc:
            # A misconfigured target (e.g. the name resolves to a dense index)
            # degrades to empty rather than failing the tool run.
            logger.warning("BM25 facet on index '%s' skipped: %s", index_name, exc)
            buckets = []
        return {
            "values": StructuredValuesPayload(
                values={"facet_field": self.config.field, "facets": buckets}
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the faceted query and its buckets (JSON-safe values)."""
        request = RetrievalRequestPayload.model_validate(inputs.get("request")).request
        values = StructuredValuesPayload.model_validate(outputs.get("values")).values
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Query", value=summarize_text(request.text, 200), kind="text"
                ),
            ],
            outputs=[NodeTraceValue(label="Facets", value=dump_outputs(values))],
        )
