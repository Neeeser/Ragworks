"""Pipeline nodes for retrieval workflows."""

from __future__ import annotations

import builtins
import logging
from typing import TYPE_CHECKING, ClassVar

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.indexing import DEFAULT_PGVECTOR_INDEX_NAME
from app.pipelines.nodes.validators import missing_index_issue
from app.pipelines.payloads import (
    QueryEmbeddingPayload,
    RetrievalPayload,
    RetrievalRequestPayload,
)
from app.pipelines.ports import NodePort
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_match_order, summarize_matches, summarize_text
from app.retrieval.models import QueryRequest
from app.retrieval.rerankers.cross_encoder import CrossEncoderReranker
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)


class RetrievalInputConfig(BaseModel):
    """Configuration for retrieval input nodes."""


class RetrievalInputNode(PipelineNodeBase[RetrievalInputConfig]):
    """Build the query request from the retrieval context."""

    type = "retrieval.input"
    label = "Retrieval Input"
    category = "retrieval"
    description = "Provide the query payload for retrieval."
    example = "Query='coffee', top_k=3 -> QueryRequest(text='coffee', top_k=3)."
    input_ports = ()
    output_ports = (NodePort(key="request", label="Request", data_type="query_request"),)
    config_model = RetrievalInputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Create a QueryRequest from context."""
        if context.query is None:
            raise ValueError("Retrieval context is missing a query string.")
        top_k = context.top_k or 5
        request = QueryRequest(
            text=context.query,
            top_k=top_k,
            namespace=None,
        )
        return {"request": RetrievalRequestPayload(request=request)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the query request inputs and outputs."""
        payload = RetrievalRequestPayload.model_validate(outputs.get("request"))
        request = payload.request
        return NodeTraceSummary(
            outputs=[
                NodeTraceValue(
                    label="Query",
                    value=summarize_text(request.text, 200),
                    kind="text",
                ),
                NodeTraceValue(
                    label="Top K",
                    value=request.top_k,
                ),
            ]
        )


class RetrieverConfig(BaseModel):
    """Configuration for Pinecone retriever nodes."""

    index_name: str = Field(default_factory=lambda: get_settings().pinecone_index_name)
    namespace: str = Field(default=DEFAULT_NAMESPACE_TEMPLATE)


class PgvectorRetrieverConfig(RetrieverConfig):
    """Configuration for pgvector retriever nodes (local default index name)."""

    index_name: str = Field(default=DEFAULT_PGVECTOR_INDEX_NAME)


class VectorRetrieverConfig(RetrieverConfig):
    """Unified retriever config: the target backend is data, not a node subtype.

    `index_name` deliberately defaults to empty -- an index must be chosen
    explicitly, and validation flags a blank one (`missing_index_issue`).
    Legacy definitions that relied on the old per-backend defaults get theirs
    filled by the startup migration (`app.pipelines.upgrades`).
    """

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend)
    )
    index_name: str = ""


class BaseRetrieverNode(PipelineNodeBase[RetrieverConfig]):
    """Shared retrieval behavior.

    Legacy subclasses pin a backend as a ClassVar; the unified
    `VectorRetrieverNode` leaves it `None` and reads the backend off its
    config (`VectorRetrieverConfig.backend`) via `resolve_backend`.
    """

    backend: ClassVar[IndexBackend | None] = None
    category = "retrieval"
    input_ports = (
        NodePort(key="query_embedding", label="Query Embedding", data_type="query_embedding"),
    )
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    # Narrowed from the base's `type[BaseModel]` so validation reads typed fields.
    config_model: builtins.type[RetrieverConfig] = RetrieverConfig

    @classmethod
    def resolve_backend(cls, config: RetrieverConfig) -> IndexBackend:
        """Return the backend this node queries: class-pinned or config-selected."""
        if cls.backend is not None:
            return cls.backend
        if isinstance(config, VectorRetrieverConfig):
            return config.backend
        raise ValueError(f"Node type '{cls.type}' does not declare a vector-store backend.")

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate required index selection."""
        config = cls.config_model.model_validate(node.config or {})
        issue = missing_index_issue(config.index_name, node.id, "Retriever")
        return [issue] if issue else []

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Retrieve chunks for the query request."""
        payload = QueryEmbeddingPayload.model_validate(inputs.get("query_embedding"))
        request = payload.request
        embedding = payload.embedding

        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.resolve_backend(self.config))
        response = store.query(
            index_name,
            namespace or "",
            embedding=embedding,
            top_k=request.top_k,
            filter=request.filter,
        )
        logger.info(
            "Pipeline retrieval returned %s matches for query.",
            len(response.matches),
        )
        return {"results": RetrievalPayload(response=response, usage=payload.usage)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize retrieval inputs and outputs."""
        input_payload = QueryEmbeddingPayload.model_validate(inputs.get("query_embedding"))
        output_payload = RetrievalPayload.model_validate(outputs.get("results"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Query",
                    value=summarize_text(input_payload.request.text, 200),
                    kind="text",
                ),
                NodeTraceValue(
                    label="Top K",
                    value=input_payload.request.top_k,
                ),
            ],
            outputs=[
                NodeTraceValue(
                    label="Matches",
                    value=summarize_matches(output_payload.response.matches),
                )
            ],
        )


class VectorRetrieverNode(BaseRetrieverNode):
    """Retrieve relevant chunks from the selected vector-store backend."""

    type = "retriever.vector"
    label = "Retriever"
    description = "Query a vector index (pgvector or Pinecone) for matching chunks."
    example = (
        "QueryEmbedding(request='coffee', embedding=[0.1, 0.2]) -> "
        "RetrievalPayload(matches=[chunk_a, chunk_b])."
    )
    config_model: builtins.type[RetrieverConfig] = VectorRetrieverConfig


class PineconeRetrieverNode(BaseRetrieverNode):
    """Deprecated Pinecone-pinned retriever; new pipelines use `retriever.vector`.

    Kept registered because node type ids are permanent -- persisted pipeline
    versions may still reference it -- but hidden from the editor catalog.
    """

    backend: ClassVar[IndexBackend] = IndexBackend.PINECONE
    type = "retriever.pinecone"
    label = "Pinecone Retriever"
    description = "Retrieve chunks from Pinecone using embeddings."
    example = (
        "QueryEmbedding(request='coffee', embedding=[0.1, 0.2]) -> "
        "RetrievalPayload(matches=[chunk_a, chunk_b])."
    )
    hidden = True


class PgvectorRetrieverNode(BaseRetrieverNode):
    """Deprecated pgvector-pinned retriever; new pipelines use `retriever.vector`.

    Kept registered because node type ids are permanent -- persisted pipeline
    versions may still reference it -- but hidden from the editor catalog.
    """

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    type = "retriever.pgvector"
    label = "pgvector Retriever"
    description = "Retrieve chunks from the built-in Postgres (pgvector) using embeddings."
    example = (
        "QueryEmbedding(request='coffee', embedding=[0.1, 0.2]) -> "
        "RetrievalPayload(matches=[chunk_a, chunk_b])."
    )
    config_model: builtins.type[RetrieverConfig] = PgvectorRetrieverConfig
    hidden = True


class RerankerConfig(BaseModel):
    """Configuration for reranking nodes."""

    enabled: bool = False
    model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"


class RerankerNode(PipelineNodeBase[RerankerConfig]):
    """Rerank retrieval results using a cross-encoder."""

    type = "reranker.cross_encoder"
    label = "Cross-Encoder Reranker"
    category = "retrieval"
    description = "Re-score retrieved chunks with a cross-encoder."
    example = "RetrievalPayload([chunk_b, chunk_a]) -> RetrievalPayload([chunk_a, chunk_b])."
    input_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    config_model = RerankerConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Rerank results when enabled."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        if not self.config.enabled:
            return {"results": payload}
        if context.query is None:
            raise ValueError("Reranker requires a query string in context.")
        reranker = CrossEncoderReranker(model_name=self.config.model_name)
        top_k = len(payload.response.matches) or None
        reranked = reranker.rerank(
            query=context.query,
            candidates=payload.response.matches,
            top_k=top_k,
        )
        response = payload.response.model_copy(update={"matches": list(reranked)})
        return {"results": RetrievalPayload(response=response, usage=payload.usage)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize reranking inputs and outputs."""
        input_payload = RetrievalPayload.model_validate(inputs.get("results"))
        output_payload = RetrievalPayload.model_validate(outputs.get("results"))
        reranker_info = {
            "enabled": self.config.enabled,
            "model": self.config.model_name,
        }
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Original order",
                    value=summarize_match_order(input_payload.response.matches),
                )
            ],
            outputs=[
                NodeTraceValue(label="Reranker", value=reranker_info),
                NodeTraceValue(
                    label="Reranked order",
                    value=summarize_match_order(output_payload.response.matches),
                ),
            ],
        )


class RetrievalOutputConfig(BaseModel):
    """Configuration for retrieval output nodes."""


class RetrievalOutputNode(PipelineNodeBase[RetrievalOutputConfig]):
    """Terminal node for retrieval pipelines."""

    type = "retrieval.output"
    label = "Retrieval Output"
    category = "retrieval"
    description = "Emit retrieval results for the API."
    example = "RetrievalPayload(matches=2) -> Result(RetrievalPayload(matches=2))."
    input_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    output_ports = (NodePort(key="result", label="Result", data_type="retrieval_results"),)
    config_model = RetrievalOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Return the retrieval payload."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        return {"result": payload}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize retrieval output payloads."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Matches",
                    value=summarize_matches(payload.response.matches),
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Result",
                    value=summarize_matches(payload.response.matches),
                )
            ],
        )


