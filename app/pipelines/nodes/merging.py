"""Merge Items: fan several item streams back into one."""

from __future__ import annotations

from pydantic import BaseModel

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import combine_usage


class MergeItemsConfig(BaseModel):
    """Configuration for the merge node (no options)."""


class MergeItemsNode(PipelineNodeBase[MergeItemsConfig]):
    """Concatenate every inbound item stream into one, in run order.

    What lets parallel intake branches — text, embedded media, page
    renders — meet before one shared describe/embed/index chain instead of
    each branch repeating it.
    """

    type = "merge.items"
    label = "Merge Items"
    category = "other"
    description = "Combine several item streams into one."
    example = "Items(3 text) + Items(2 images) -> Items(5)."
    input_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            accepts_many=True,
        ),
    )
    output_ports = (
        NodePort(key="items", label="Items", data_type=PortKind.ITEMS, preserves=True),
    )
    config_model = MergeItemsConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Concatenate the inbound streams, summing their usage."""
        batches = _collect(inputs)
        return {
            "items": ItemBatch(
                items=[item for batch in batches for item in batch.items],
                tokenizer=next(
                    (batch.tokenizer for batch in batches if batch.tokenizer is not None), None
                ),
                usage=combine_usage([batch.usage for batch in batches]),
            )
        }

    def summarize_io(
        self, inputs: dict[str, object], outputs: dict[str, object]
    ) -> NodeTraceSummary:
        """Record every branch's items and the merged stream."""
        batches = _collect(inputs)
        merged = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label=f"Items (branch {index})",
                    value=trace_items(batch.items),
                    kind="items",
                )
                for index, batch in enumerate(batches, start=1)
            ],
            outputs=[
                NodeTraceValue(label="Merged", value={"count": len(merged.items)}),
                NodeTraceValue(
                    label="Merged items", value=trace_items(merged.items), kind="items"
                ),
            ],
        )


def _collect(inputs: dict[str, object]) -> list[ItemBatch]:
    """Validate the variadic `items` input into typed batches.

    The executor always delivers an `accepts_many` port as a list; a bare
    batch is tolerated for direct node-level callers (tests).
    """
    raw = inputs.get("items")
    values = raw if isinstance(raw, list) else [raw]
    return [ItemBatch.model_validate(value) for value in values]
