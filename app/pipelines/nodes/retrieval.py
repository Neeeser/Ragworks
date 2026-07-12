"""Retriever and reranker pipeline nodes.

The retrieval boundary nodes (`retrieval.input`/`retrieval.output`) live in
`io.py` with the ingestion boundaries; fusion nodes live in `fusion.py`.
"""

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
from app.pipelines.nodes.validators import lexical_support_issue, missing_index_issue
from app.pipelines.payloads import (
    QueryEmbeddingPayload,
    RetrievalPayload,
    RetrievalRequestPayload,
)
from app.pipelines.ports import NodePort
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_match_order, summarize_matches, summarize_text
from app.retrieval.models import RetrievalResponse
from app.retrieval.rerankers.cross_encoder import CrossEncoderReranker
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError, NotFoundError
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)


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
        try:
            response = store.query(
                index_name,
                namespace or "",
                embedding=embedding,
                top_k=request.top_k,
                filter=request.filter,
            )
        except NotFoundError:
            # The index is created by the first ingest; querying before then
            # is an honest empty result, not an error.
            logger.info("Index '%s' does not exist yet; returning no matches.", index_name)
            response = RetrievalResponse(matches=[])
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


class Bm25RetrieverConfig(BaseModel):
    """Configuration for BM25 (sparse/lexical) retriever nodes."""

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend)
    )
    index_name: str = ""
    namespace: str = Field(default=DEFAULT_NAMESPACE_TEMPLATE)


class Bm25RetrieverNode(PipelineNodeBase[Bm25RetrieverConfig]):
    """Retrieve chunks by lexical (BM25) match on the raw query text.

    Takes the query request directly — no embedding step — so it runs in
    parallel with the embed → dense-retrieve branch and feeds a fusion node.
    """

    type = "retriever.bm25"
    label = "BM25 Retriever"
    category = "retrieval"
    description = (
        "Query a sparse BM25 index with the raw query text for exact-term "
        "(lexical) matches — no embeddings involved."
    )
    example = "QueryRequest(text='error E1042') -> RetrievalPayload(matches=[chunk_a])."
    input_ports = (NodePort(key="request", label="Request", data_type="query_request"),)
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    config_model = Bm25RetrieverConfig

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
        index_issue = missing_index_issue(config.index_name, node.id, "BM25 retriever")
        if index_issue:
            issues.append(index_issue)
        support_issue = lexical_support_issue(
            CAPABILITIES_BY_BACKEND[config.backend], config.backend.value, node.id
        )
        if support_issue:
            issues.append(support_issue)
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Retrieve lexically matching chunks for the query request."""
        payload = RetrievalRequestPayload.model_validate(inputs.get("request"))
        request = payload.request

        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.config.backend)
        try:
            response = store.lexical_query(
                index_name,
                namespace or "",
                text=request.text,
                top_k=request.top_k,
                filter=request.filter,
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
        logger.info(
            "Pipeline BM25 retrieval returned %s matches for query.",
            len(response.matches),
        )
        return {"results": RetrievalPayload(response=response)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize BM25 retrieval inputs and outputs."""
        input_payload = RetrievalRequestPayload.model_validate(inputs.get("request"))
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
