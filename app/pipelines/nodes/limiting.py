"""Result-shaping nodes: cut an ordered result stream by count, identity, or score.

The cut points in the ranking stage: retrievers may over-fetch (e.g.
`top_k * 2`), fusion/reranking reorders the candidates, and these nodes
narrow the final list — Result Limit by position, Deduplicate Results by
chunk identity, Score Threshold by score. Every cut is one item stream in,
one item stream out, and every one keeps the complete input item list in the
trace next to its output, so what a node dropped is visible rather than
inferred. All three are optional: a pipeline without them returns everything
its last ranking node emitted.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import EmptyConfig, PipelineNodeBase
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    summarize_match_order,
    summarize_matches,
)


def _candidate_trace(batch: ItemBatch) -> list[NodeTraceValue]:
    """The shared input side of a result-shaping trace: order plus identities."""
    return [
        NodeTraceValue(label="Candidates", value=summarize_matches(batch.preview_matches())),
        NodeTraceValue(
            label="Candidate order", value=summarize_match_order(batch.preview_matches())
        ),
        NodeTraceValue(label="Candidate items", value=trace_items(batch.items), kind="items"),
    ]


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
            inputs=_candidate_trace(input_batch),
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


def _identity(item: Item) -> tuple[str | None, str]:
    """The chunk this item stands for: its document and its stable chunk id.

    Chunk ids are `{document_id}:{order}`, so the id alone already separates
    chunks of different documents; the document is carried alongside it
    because an item rebuilt from a store row may have been re-keyed by the
    node that produced it, and two branches must still agree on what "the
    same chunk" means.
    """
    return (item.document_id, item.id)


def _rank_score(item: Item) -> float:
    """Score for ranking purposes; an unscored item sorts below every scored one."""
    return item.score if item.score is not None else float("-inf")


class DeduplicateResultsNode(PipelineNodeBase[EmptyConfig]):
    """Collapse repeated chunks in a merged result stream to one occurrence each."""

    type = "filter.dedupe"
    label = "Deduplicate Results"
    category = "retrieval"
    description = (
        "Keep one occurrence of each retrieved chunk. Overlapping branches "
        "(semantic + keyword, several collections) return the same chunk more "
        "than once; fusion reorders those duplicates but never removes them, "
        "and Result Limit then spends its budget on repeats. Identity is the "
        "chunk itself (document id + chunk id); the highest-scored occurrence "
        "survives, at the position of the first, so the input's ranking is "
        "unchanged. One item stream in, one out, never longer than the input."
    )
    example = (
        "Items(a:0.9, b:0.7, a:0.4) -> Items(a:0.9, b:0.7); "
        "Items(a:0.4, b:0.7, a:0.9) -> Items(a:0.9, b:0.7)."
    )
    input_ports = (NodePort(key="items", label="Results", data_type=PortKind.ITEMS),)
    output_ports = (
        NodePort(key="items", label="Results", data_type=PortKind.ITEMS, preserves=True),
    )
    config_model = EmptyConfig

    def run(self, inputs: dict[str, object], _context: PipelineRunContext) -> dict[str, object]:
        """Emit the best occurrence of each chunk, in first-occurrence order."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        best: dict[tuple[str | None, str], Item] = {}
        for item in batch.items:
            kept = best.get(_identity(item))
            # Strictly greater keeps the first occurrence on a tie.
            if kept is None or _rank_score(item) > _rank_score(kept):
                best[_identity(item)] = item
        return {"items": batch.model_copy(update={"items": list(best.values())})}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the full input against the deduplicated output."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=_candidate_trace(input_batch),
            outputs=[
                NodeTraceValue(
                    label="Kept",
                    value={
                        "kept": len(output_batch.items),
                        "duplicates_removed": len(input_batch.items) - len(output_batch.items),
                    },
                ),
                NodeTraceValue(
                    label="Kept items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
            ],
        )


class ScoreThresholdConfig(BaseModel):
    """Configuration for the score-threshold node."""

    min_score: float = Field(
        default=0.0,
        title="Minimum score",
        description=(
            "Drop every item scoring below this value; an item scoring exactly "
            "it is kept. The scale is whatever the upstream node emits — cosine "
            "similarity from a retriever, a reranker's relevance score, or an "
            "RRF score, which is small (about 1/60 per branch hit) and not "
            "comparable to either. Read the trace's candidate scores before "
            "picking a number, and expect an empty result set below a threshold "
            "no candidate reaches."
        ),
    )


class ScoreThresholdNode(PipelineNodeBase[ScoreThresholdConfig]):
    """Drop retrieval results scoring below a configured minimum."""

    type = "filter.score"
    label = "Score Threshold"
    category = "retrieval"
    description = (
        "Keep only the results scoring at or above a minimum. Result Limit caps "
        "how many results a query returns; this caps how weak they may be, so a "
        "query with nothing relevant in the corpus returns nothing instead of "
        "the least-bad rows. Requires a score on every item, and preserves the "
        "order it received. One item stream in, one out, never longer than the "
        "input — and legitimately empty."
    )
    example = "Items(a:0.82, b:0.41), min_score=0.5 -> Items(a:0.82)."
    input_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            requires=(Facet.SCORE,),
        ),
    )
    output_ports = (
        NodePort(key="items", label="Results", data_type=PortKind.ITEMS, preserves=True),
    )
    config_model = ScoreThresholdConfig

    def run(self, inputs: dict[str, object], _context: PipelineRunContext) -> dict[str, object]:
        """Keep the items scoring at or above the configured minimum."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        kept = [item for item in batch.items if self._passes(item)]
        return {"items": batch.model_copy(update={"items": kept})}

    def _passes(self, item: Item) -> bool:
        """True when the item carries a score meeting the threshold.

        The port requires the score facet, but a mixed stream can still
        deliver an unscored item at run time; it is dropped rather than
        admitted, because nothing established that it clears the bar.
        """
        return item.score is not None and item.score >= self.config.min_score

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the threshold applied and what survived it."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=_candidate_trace(input_batch),
            outputs=[
                NodeTraceValue(
                    label="Kept",
                    value={
                        "min_score": self.config.min_score,
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
