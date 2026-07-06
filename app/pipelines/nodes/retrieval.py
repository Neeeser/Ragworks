"""Pipeline nodes for retrieval workflows."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
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
from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig
from app.retrieval.models import QueryRequest
from app.retrieval.rerankers.cross_encoder import CrossEncoderReranker
from app.retrieval.retrievers.pinecone_retriever import PineconeRetriever

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


class PineconeRetrieverNode(PipelineNodeBase[RetrieverConfig]):
    """Retrieve relevant chunks from Pinecone."""

    type = "retriever.pinecone"
    label = "Pinecone Retriever"
    category = "retrieval"
    description = "Retrieve chunks from Pinecone using embeddings."
    example = (
        "QueryEmbedding(request='coffee', embedding=[0.1, 0.2]) -> "
        "RetrievalPayload(matches=[chunk_a, chunk_b])."
    )
    input_ports = (
        NodePort(key="query_embedding", label="Query Embedding", data_type="query_embedding"),
    )
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    config_model = RetrieverConfig

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate required Pinecone index selection."""
        config = RetrieverConfig.model_validate(node.config or {})
        issue = missing_index_issue(config.index_name, node.id, "Retriever")
        return [issue] if issue else []

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Retrieve chunks for the query request."""
        payload = QueryEmbeddingPayload.model_validate(inputs.get("query_embedding"))
        request = payload.request
        embedding = payload.embedding

        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = resolve_collection_template(self.config.index_name, context.collection)

        index_config = PineconeIndexConfig(
            name=index_name,
            namespace=namespace,
        )
        retriever = PineconeRetriever(
            index_config=index_config,
            client=context.pinecone,
        )
        response = retriever.retrieve(
            QueryRequest(
                text=request.text,
                top_k=request.top_k,
                namespace=namespace,
                filter=request.filter,
            ),
            embedding=embedding,
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


class ChatSettingsConfig(BaseModel):
    """Configuration for chat model settings."""

    chat_model: str = Field(default_factory=lambda: get_settings().default_chat_model)
    context_window: int = Field(default=8192, gt=0)


class ChatSettingsNode(PipelineNodeBase[ChatSettingsConfig]):
    """Configure chat model settings for the retrieval pipeline."""

    type = "chat.settings"
    label = "Chat Settings"
    category = "retrieval"
    description = "Configure the chat model and context window used for generation."
    example = "chat_model='openai/gpt-oss-120b', context_window=8192."
    input_ports = ()
    output_ports = ()
    config_model = ChatSettingsConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """No-op node for storing chat settings in pipeline definitions."""
        return {}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize chat settings configuration."""
        return NodeTraceSummary(
            outputs=[
                NodeTraceValue(
                    label="Chat settings",
                    value={
                        "chat_model": self.config.chat_model,
                        "context_window": self.config.context_window,
                    },
                )
            ]
        )
