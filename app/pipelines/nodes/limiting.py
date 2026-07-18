"""Top-N node: truncate an ordered result stream to its top N matches.

The single cut point in the ranking stage: retrievers may over-fetch (e.g.
`top_k * 2`), fusion/reranking reorders the candidates, and this node cuts
the final list. Fusion never truncates, so the cut is always an explicit,
traced step — the trace keeps the complete input item list next to the
truncated output so the cut is visible, never hidden. The node is optional:
a pipeline without one simply returns everything its last ranking node
emitted.
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

    top_n: int | None = Field(
        default=None,
        gt=0,
        description=(
            "Keep the first N matches of the ordered input and drop the "
            "rest — typically the top_k variable, so the caller's requested "
            "depth is what survives an over-retrieving, fused pipeline. "
            "Unset: the run's requested top_k."
        ),
    )


class LimitNode(PipelineNodeBase[LimitConfig]):
    """Keep the top N matches of an ordered retrieval result stream."""

    type = "limit.top_n"
    label = "Top-N"
    category = "retrieval"
    description = "Cut ordered results to the top N matches (default: the requested top_k)."
    example = "RetrievalPayload(a, b, c), top_n=2 -> RetrievalPayload(a, b)."
    input_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    config_model = LimitConfig

    def __init__(self, config: LimitConfig) -> None:
        """Track the run's effective depth so the trace can report it."""
        super().__init__(config)
        self._effective_top_n: int | None = config.top_n

    def _resolve_top_n(self, context: PipelineRunContext) -> int | None:
        """Return the effective cut depth: explicit config, else requested top_k."""
        if self.config.top_n is not None:
            return self.config.top_n
        if context.top_k is not None:
            # A requested top_k of 0 means zero results, never "no cut".
            return max(context.top_k, 0)
        return None

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Truncate the ordered match list to the effective depth."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        self._effective_top_n = self._resolve_top_n(context)
        matches = list(payload.response.matches)
        if self._effective_top_n is not None:
            matches = matches[: self._effective_top_n]
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
                        "top_n": self._effective_top_n,
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
