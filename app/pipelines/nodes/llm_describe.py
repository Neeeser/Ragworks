"""Vision LLM node: turn image items into text a text index can hold.

The shell behind describing an image and reading the text in one — both
the same node with a different prompt. It is a facet shell over the shared
engine like every other `llm.*` node; what makes it the vision one is the
port contract (accepts images, adds text) and that the engine attaches
each item's image bytes to its call.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.llm.engine import LlmCall, LlmEngine
from app.pipelines.llm.mapping import apply_annotations
from app.pipelines.llm.output_schema import per_item_schema, validate_fields
from app.pipelines.llm.presets import DESCRIBE_PRESETS
from app.pipelines.llm.prompts import PromptContext, render
from app.pipelines.llm.summaries import llm_call_summary_values
from app.pipelines.llm.validation import TRANSFORM_TARGETS, ShellRules, shell_issues
from app.pipelines.model_modality_rules import ModelModalityRule
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import combine_usage
from app.schemas.enums import ProviderKind
from app.schemas.media import InlineMedia

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry

_RULES = ShellRules(
    node_label="Vision transform",
    allowed_targets=TRANSFORM_TARGETS,
    allowed_placeholders=frozenset({"text", "query", "document_text"}),
    # The image is this shell's per-item payload, so a prompt referencing
    # no per-item variable still asks a different question of every item.
    carries_media=True,
)


class LlmDescribeNode(PipelineNodeBase[LlmNodeConfig]):
    """Describe or transcribe each image item through a vision model."""

    type = "llm.describe"
    label = "Vision Transform"
    category = "llm"
    description = (
        "Send each image item to a vision model and write what it returns "
        "onto the item — a description, or the text read out of it."
    )
    example = "Items([image]) -> Items([image + 'A bar chart of quarterly revenue'])."
    input_ports = (
        NodePort(
            key="items",
            label="Images",
            data_type=PortKind.ITEMS,
            accepts=(Facet.IMAGE,),
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            adds=(Facet.TEXT,),
            preserves=True,
        ),
    )
    config_model = LlmNodeConfig
    presets = DESCRIBE_PRESETS
    model_modality = ModelModalityRule(kind=ProviderKind.CHAT)

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

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Describe every image item; non-image items pass through untouched."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        partition = partition_items(batch.items, self.input_ports[0])
        if not partition.accepted:
            return {"items": batch}
        engine = LlmEngine(
            context.providers,
            self.config,
            node_label=self.label,
            strict=context.document is not None,
        )
        self._mechanism = engine.mechanism
        fields = self.config.output_fields
        schema = per_item_schema(fields)
        calls = [self._call(item, context) for item in partition.accepted]
        outcomes = engine.run_calls(calls, schema, lambda payload: validate_fields(payload, fields))
        described = [
            apply_annotations(item, fields, outcome.values) if outcome.values is not None else item
            for item, outcome in zip(partition.accepted, outcomes, strict=True)
        ]
        self._warnings = engine.warnings
        self._retries = sum(outcome.retries for outcome in outcomes)
        usage = combine_usage([batch.usage, engine.combined_usage(outcomes)])
        return {
            "items": batch.model_copy(update={"items": partition.merge(described), "usage": usage})
        }

    def _call(self, item: Item, context: PipelineRunContext) -> LlmCall:
        """Build one call: the rendered prompts plus the item's image bytes."""
        prompt_context = PromptContext(
            text=item.text,
            query=context.query,
            metadata=dict(item.metadata.data),
        )
        images: tuple[InlineMedia, ...] = ()
        if item.image is not None:
            images = (
                InlineMedia(
                    media_type=item.image.media_type,
                    data=context.storage.read_bytes(item.image.path),
                ),
            )
        return LlmCall(
            system=render(self.config.system_prompt, prompt_context),
            user=render(self.config.prompt, prompt_context),
            images=images,
        )

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the described stream and the calls that produced it."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Input items", value=trace_items(input_batch.items), kind="items"
                ),
                partition_trace_value(
                    partition_items(input_batch.items, self.input_ports[0]),
                    label="Not described",
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
                    label="Described items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
            ],
        )
