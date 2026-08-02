"""Listwise LLM reranker/judge node.

One structured call scores the whole candidate list against the query; an
optional threshold turns the reranker into a judge that drops weak items.
Items the model omits from its results keep their original score (0.0 when
unscored) rather than vanishing — dropping is the threshold's job alone.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.llm.engine import LlmEngine
from app.pipelines.llm.mapping import apply_annotations
from app.pipelines.llm.output_schema import listwise_schema, validate_listwise
from app.pipelines.llm.presets import RERANK_PRESETS
from app.pipelines.llm.prompts import PromptContext, render, render_items_block
from app.pipelines.llm.summaries import llm_call_summary_values
from app.pipelines.llm.validation import ShellRules, shell_issues
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import combine_usage, summarize_match_order

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry

_RULES = ShellRules(
    node_label="LLM reranker",
    allowed_targets=frozenset({"score", "metadata"}),
    allowed_placeholders=frozenset({"items", "query"}),
)


class LlmRerankConfig(LlmNodeConfig):
    """Reranker config: the shared LLM contract plus the judge threshold."""

    drop_below: float | None = Field(
        default=None,
        description="Drop items scoring below this after reranking (judge mode).",
    )


class LlmRerankNode(PipelineNodeBase[LlmRerankConfig]):
    """Rerank the candidate list through one listwise structured LLM call."""

    type = "llm.rerank"
    label = "LLM Reranker"
    category = "llm"
    description = (
        "Score and reorder retrieved chunks with a structured LLM call over "
        "the whole list; optionally drop items below a score threshold."
    )
    example = "Items([chunk_b, chunk_a]) -> Items([chunk_a, chunk_b])."
    input_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            requires=(Facet.TEXT,),
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            adds=(Facet.SCORE,),
            preserves=True,
        ),
    )
    config_model = LlmRerankConfig
    presets = RERANK_PRESETS

    def __init__(self, config: LlmRerankConfig) -> None:
        """Initialize the node and its per-run trace stash."""
        super().__init__(config)
        self._warnings: list[str] = []
        self._retries = 0
        self._mechanism: str | None = None

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Check config completeness, targets, and prompt placeholders."""
        config = LlmRerankConfig.model_validate(node.config or {})
        issues = shell_issues(node, definition, config, _RULES)
        if config.output_fields and not any(
            spec.target.kind == "score" for spec in config.output_fields
        ):
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"LLM reranker node '{node.id}' has no output field "
                        "targeting the score — nothing would be reranked."
                    ),
                    severity="error",
                    node_id=node.id,
                    field="output_fields",
                )
            )
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Score every candidate in one call; degrade to the original order."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        if not batch.items:
            return {"items": batch}
        engine = LlmEngine(context, self.config, node_label=self.label)
        self._mechanism = engine.mechanism
        fields = self.config.output_fields
        prompt_context = PromptContext(
            query=context.query,
            items_block=render_items_block(
                [item.text or "" for item in batch.items]
            ),
        )
        prompts = [
            (
                render(self.config.system_prompt, prompt_context),
                render(self.config.prompt, prompt_context),
            )
        ]
        schema = listwise_schema(fields)
        count = len(batch.items)
        outcomes = engine.run_calls(
            prompts, schema, lambda payload: validate_listwise(payload, fields, count)
        )
        outcome = outcomes[0]
        self._warnings = engine.warnings
        self._retries = outcome.retries
        usage = combine_usage([batch.usage, engine.combined_usage(outcomes)])
        if outcome.values is None:
            return {"items": batch.model_copy(update={"usage": usage})}
        items = self._apply(batch.items, outcome.values)
        return {"items": batch.model_copy(update={"items": items, "usage": usage})}

    def _apply(
        self, items: list[Item], by_index: dict[int, dict[str, Any]]
    ) -> list[Item]:
        """Apply scores, reorder best-first, and drop below the threshold."""
        fields = self.config.output_fields
        updated: list[Item] = []
        for position, item in enumerate(items):
            values = by_index.get(position)
            if values is not None:
                item = apply_annotations(item, fields, values)
            if item.score is None:
                item = item.model_copy(update={"score": 0.0})
            updated.append(item)
        updated.sort(key=lambda entry: entry.score or 0.0, reverse=True)
        threshold = self.config.drop_below
        if threshold is not None:
            updated = [entry for entry in updated if (entry.score or 0.0) >= threshold]
        return updated

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize order change, dropped items, and the call that did it."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Original order",
                    value=summarize_match_order(input_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Original items", value=trace_items(input_batch.items), kind="items"
                ),
            ],
            outputs=[
                *llm_call_summary_values(
                    self.config,
                    mechanism=self._mechanism,
                    warnings=self._warnings,
                    retries=self._retries,
                    usage=output_batch.usage,
                ),
                NodeTraceValue(
                    label="Reranked order",
                    value=summarize_match_order(output_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Reranked items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
            ],
        )
