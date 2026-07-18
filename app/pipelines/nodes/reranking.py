"""Reranking pipeline nodes: re-score retrieved chunks with a cross-encoder."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_match_order, trace_match_items
from app.retrieval.rerankers.cross_encoder import CrossEncoderReranker


class RerankerConfig(BaseModel):
    """Configuration for reranking nodes."""

    enabled: bool = Field(
        default=False,
        description=(
            "Run the cross-encoder on this node's input. Disabled, the node "
            "passes results through unchanged — flip it to compare ranked "
            "and unranked quality on the same pipeline."
        ),
    )
    model_name: str = Field(
        default="cross-encoder/ms-marco-MiniLM-L-6-v2",
        description=(
            "Cross-encoder checkpoint (HuggingFace id) that scores each "
            "query-chunk pair. Downloaded and run locally on first use."
        ),
    )


class RerankerNode(PipelineNodeBase[RerankerConfig]):
    """Rerank retrieval results using a cross-encoder."""

    type = "reranker.cross_encoder"
    label = "Cross-Encoder Reranker"
    category = "retrieval"
    description = (
        "Re-scores each retrieved chunk against the query with a "
        "cross-encoder, which reads both texts together — slower than vector "
        "similarity but sharper on relevance, so it usually runs after "
        "fusion on a modest candidate set."
    )
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
        original_items = trace_match_items(input_payload.response.matches)
        reranked_items = trace_match_items(output_payload.response.matches)
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Original order", value=summarize_match_order(input_payload.response.matches)
                ),
                NodeTraceValue(label="Original items", value=original_items, kind="items"),
            ],
            outputs=[
                NodeTraceValue(label="Reranker", value=reranker_info),
                NodeTraceValue(
                    label="Reranked order", value=summarize_match_order(output_payload.response.matches)
                ),
                NodeTraceValue(label="Reranked items", value=reranked_items, kind="items"),
            ],
        )
