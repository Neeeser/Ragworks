"""Structured tool terminal: merged named values become the tool result.

Split from `io.py` (the ingestion/retrieval boundary nodes): this module owns
the structured result plane — the shared declared-output evaluator and the
`tool.output` terminal whose merged values ARE a structured tool's result.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.expressions import ExpressionError, ModelValue, evaluate, parse
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import (
    RetrievalPayload,
    StructuredValue,
    StructuredValuesPayload,
    dump_outputs,
)
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import combine_usage
from app.pipelines.variables import PipelineOutputField
from app.retrieval.models import RetrievalResponse


def evaluate_output_fields(
    fields: list[PipelineOutputField], context: PipelineRunContext
) -> dict[str, int | float | str | bool]:
    """Evaluate declared output expressions against the run environment.

    Validation checks these statically; a failure here (or a bare model
    value, which has no scalar wire shape) is an honest run error. Shared by
    the chunk (`retrieval.output`) and structured (`tool.output`) terminals.
    """
    if not fields or context.variables is None:
        return {}
    results: dict[str, int | float | str | bool] = {}
    for output in fields:
        try:
            value = evaluate(parse(output.expression), context.variables.values)
        except ExpressionError as error:
            raise ValueError(f"Output '{output.name}': {error.message}") from error
        if isinstance(value, ModelValue):
            raise ValueError(
                f"Output '{output.name}': dereference the model variable with "
                ".connection_id or .model_name."
            )
        results[output.name] = value
    return results


class ToolOutputConfig(BaseModel):
    """Configuration for structured tool output nodes.

    `outputs` declares extra named expressions evaluated against the run's
    variable environment, merged beside the inbound structured values.
    """

    outputs: list[PipelineOutputField] = Field(default_factory=list)


class ToolOutputNode(PipelineNodeBase[ToolOutputConfig]):
    """Terminal node for structured tools: merged values ARE the result.

    Emits the same result payload shape as `retrieval.output` with no
    matches — extraction stays single-pathed; the discriminated kind comes
    from the pipeline's derived interface, which recognizes this node type.
    """

    type = "tool.output"
    label = "Tool Output"
    category = "tools"
    description = "Emit named structured values as the tool's result."
    example = "StructuredValues(matching_documents=2) -> Result(outputs={...})."
    input_ports = (
        NodePort(
            key="values",
            label="Values",
            data_type="structured_values",
            accepts_many=True,
        ),
    )
    output_ports = (NodePort(key="result", label="Result", data_type="retrieval_results"),)
    config_model = ToolOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Merge inbound structured values (edge order) plus declared outputs."""
        raw_values = inputs.get("values") or []
        payloads = [
            StructuredValuesPayload.model_validate(item)
            for item in (raw_values if isinstance(raw_values, list) else [raw_values])
        ]
        merged: dict[str, StructuredValue] = {}
        for payload in payloads:
            merged.update(payload.values)
        merged.update(evaluate_output_fields(self.config.outputs, context))
        usage = combine_usage([payload.usage for payload in payloads])
        return {
            "result": RetrievalPayload(
                response=RetrievalResponse(matches=[]),
                usage=usage,
                outputs=merged,
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the merged structured result."""
        del inputs
        result = RetrievalPayload.model_validate(outputs.get("result"))
        return NodeTraceSummary(
            outputs=[NodeTraceValue(label="Outputs", value=dump_outputs(result.outputs))]
        )
