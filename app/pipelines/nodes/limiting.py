"""Result-limit node: truncate an ordered result stream to a maximum size.

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
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    summarize_match_order,
    summarize_matches,
)


class ResultLimitConfig(BaseModel):
    """Configuration for result-limiting nodes."""

    max_results: int | None = Field(
        default=None,
        gt=0,
        description=(
            "Keep the first N matches of the ordered input and drop the "
            "rest — typically the result_limit variable, so the caller's "
            "requested limit survives an over-retrieving, fused pipeline. "
            "Unset: the run's requested result limit."
        ),
    )


class ResultLimitNode(PipelineNodeBase[ResultLimitConfig]):
    """Keep at most the configured number of ordered retrieval matches."""

    type = "limit.results"
    label = "Result Limit"
    category = "retrieval"
    description = "Cut ordered results to the requested maximum result count."
    example = "Items(a, b, c), max_results=2 -> Items(a, b)."
    input_ports = (NodePort(key="items", label="Results", data_type=PortKind.ITEMS),)
    output_ports = (
        NodePort(key="items", label="Results", data_type=PortKind.ITEMS, preserves=True),
    )
    config_model = ResultLimitConfig

    def __init__(self, config: ResultLimitConfig) -> None:
        """Track the run's effective depth so the trace can report it."""
        super().__init__(config)
        self._effective_max_results: int | None = config.max_results

    def _resolve_max_results(self, context: PipelineRunContext) -> int | None:
        """Return the explicit cut depth, or the request boundary's limit."""
        if self.config.max_results is not None:
            return self.config.max_results
        if context.top_k is not None:
            # A requested top_k of 0 means zero results, never "no cut".
            return max(context.top_k, 0)
        return None

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Truncate the ordered item list to the effective depth."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        self._effective_max_results = self._resolve_max_results(context)
        items = list(batch.items)
        if self._effective_max_results is not None:
            items = items[: self._effective_max_results]
        return {"items": batch.model_copy(update={"items": items})}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the full input order against the truncated output."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Candidates",
                    value=summarize_matches(input_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Candidate order",
                    value=summarize_match_order(input_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Candidate items",
                    value=trace_items(input_batch.items),
                    kind="items",
                ),
            ],
            outputs=[
                NodeTraceValue(
                    label="Kept",
                    value={
                        "max_results": self._effective_max_results,
                        "kept": len(output_batch.items),
                        "dropped": len(input_batch.items) - len(output_batch.items),
                    },
                ),
                NodeTraceValue(
                    label="Kept items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
            ],
        )
