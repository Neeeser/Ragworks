"""Per-item LLM transform node: rewrite text and extract metadata.

The shell behind contextual retrieval, question-oriented augmentation,
metadata extraction, and summarization — all the same node with a different
prompt, output fields, and mapping. One structured LLM call per item,
fanned out through the shared engine's connection throttle.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.llm.engine import LlmCall, LlmEngine
from app.pipelines.llm.mapping import apply_annotations
from app.pipelines.llm.output_schema import per_item_schema, validate_fields
from app.pipelines.llm.presets import TRANSFORM_PRESETS
from app.pipelines.llm.prompts import PromptContext, render
from app.pipelines.llm.summaries import llm_call_summary_values
from app.pipelines.llm.validation import (
    TRANSFORM_TARGETS,
    ShellRules,
    removes_from_text_writes,
    shell_issues,
)
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import combine_usage

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry

_RULES = ShellRules(
    node_label="LLM transform",
    allowed_targets=TRANSFORM_TARGETS,
    allowed_placeholders=frozenset({"text", "query", "document_text"}),
)


class LlmTransformNode(PipelineNodeBase[LlmNodeConfig]):
    """Annotate every item through one structured LLM call per item."""

    type = "llm.transform"
    label = "LLM Transform"
    category = "llm"
    description = (
        "Run a structured LLM call per item to rewrite its text or add "
        "metadata fields. The prompt and output fields are configurable."
    )
    example = "Items([chunk]) -> Items([chunk + situating context])."
    input_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            accepts=(Facet.TEXT,),
        ),
        # The whole document, for prompts situating a chunk in it. Read as
        # context rather than processed, so it declares no accepts and
        # nothing arriving on it reaches this node's output.
        NodePort(
            key="document",
            label="Document",
            data_type=PortKind.ITEMS,
            required=False,
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            preserves=True,
        ),
    )
    config_model = LlmNodeConfig
    presets = TRANSFORM_PRESETS

    def __init__(self, config: LlmNodeConfig) -> None:
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
        config = LlmNodeConfig.model_validate(node.config or {})
        return shell_issues(node, definition, config, _RULES)

    @classmethod
    def removes_for_node(cls, config: dict[str, object]) -> dict[str, tuple[str, ...]]:
        """Rewriting an item's text invalidates what was derived from it."""
        return removes_from_text_writes(config)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Annotate the textual items; failed calls pass items through when degrading."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        partition = partition_items(batch.items, self.input_ports[0])
        if not partition.accepted:
            return {"items": batch}
        document_text = _document_text(inputs)
        engine = LlmEngine(
            context.providers,
            self.config,
            node_label=self.label,
            strict=context.document is not None,
        )
        self._mechanism = engine.mechanism
        fields = self.config.output_fields
        schema = per_item_schema(fields)
        calls = [
            LlmCall(
                system=render(self.config.system_prompt, prompt_context),
                user=render(self.config.prompt, prompt_context),
            )
            for prompt_context in (
                PromptContext(
                    text=item.text,
                    query=context.query,
                    document_text=document_text,
                    metadata=dict(item.metadata.data),
                )
                for item in partition.accepted
            )
        ]
        outcomes = engine.run_calls(calls, schema, lambda payload: validate_fields(payload, fields))
        annotated = [
            apply_annotations(item, fields, outcome.values) if outcome.values is not None else item
            for item, outcome in zip(partition.accepted, outcomes, strict=True)
        ]
        self._warnings = engine.warnings
        self._retries = sum(outcome.retries for outcome in outcomes)
        usage = combine_usage([batch.usage, engine.combined_usage(outcomes)])
        return {
            "items": batch.model_copy(update={"items": partition.merge(annotated), "usage": usage})
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the transformed stream and the calls that produced it."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Input items", value=trace_items(input_batch.items), kind="items"
                ),
                partition_trace_value(
                    partition_items(input_batch.items, self.input_ports[0]), label="Not transformed"
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
                    label="Transformed items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
            ],
        )


def _document_text(inputs: dict[str, object]) -> str | None:
    """Text of the optionally wired document stream.

    Several text items (one per parse node feeding the port) join into one
    document, so the prompt sees everything that was extracted.
    """
    payload: Any = inputs.get("document")
    if payload is None:
        return None
    batch = ItemBatch.model_validate(payload)
    texts = [item.text for item in batch.items if item.text is not None]
    return "\n\n".join(texts) if texts else None
