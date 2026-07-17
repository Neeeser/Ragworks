"""Limit node: truncate an ordered result stream to its top N matches.

The clamp for over-retrieval pipelines: retrievers fetch extra candidates
(e.g. `top_k * 2`), fusion/reranking reorders them, and this node cuts the
final list back down (e.g. to `top_k`). The trace keeps the complete input
item list next to the truncated output so the cut is visible, never hidden.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    summarize_match_order,
    summarize_matches,
    trace_match_items,
)


class LimitConfig(BaseModel):
    """Configuration for result-limiting nodes."""

    top_n: int = Field(
        default=10,
        gt=0,
        description="Keep only the first N matches of the ordered input.",
    )


class LimitNode(PipelineNodeBase[LimitConfig]):
    """Keep the top N matches of an ordered retrieval result stream."""

    type = "limit.top_n"
    label = "Limit"
    category = "retrieval"
    description = "Truncate ordered results to the top N matches."
    example = "RetrievalPayload(a, b, c), top_n=2 -> RetrievalPayload(a, b)."
    input_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    config_model = LimitConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Truncate the ordered match list to the configured depth."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        matches = list(payload.response.matches)[: self.config.top_n]
        response = payload.response.model_copy(update={"matches": matches})
        return {"results": payload.model_copy(update={"response": response})}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the full input order against the truncated output."""
        input_payload = RetrievalPayload.model_validate(inputs.get("results"))
        output_payload = RetrievalPayload.model_validate(outputs.get("results"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Candidates",
                    value=summarize_matches(input_payload.response.matches),
                ),
                NodeTraceValue(
                    label="Candidate order",
                    value=summarize_match_order(input_payload.response.matches),
                ),
                NodeTraceValue(
                    label="Candidate items",
                    value=trace_match_items(input_payload.response.matches),
                    kind="items",
                ),
            ],
            outputs=[
                NodeTraceValue(
                    label="Kept",
                    value={
                        "top_n": self.config.top_n,
                        "kept": len(output_payload.response.matches),
                        "dropped": len(input_payload.response.matches)
                        - len(output_payload.response.matches),
                    },
                ),
                NodeTraceValue(
                    label="Kept items",
                    value=trace_match_items(output_payload.response.matches),
                    kind="items",
                ),
            ],
        )
