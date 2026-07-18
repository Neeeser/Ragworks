"""Provider-backed pipeline node for reranking retrieved chunks."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.payloads import RetrievalPayload
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_match_order, trace_match_items
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.services.errors import InvalidInputError

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry


class RerankerConfig(BaseModel):
    """Select the provider connection and model used for reranking."""

    connection_id: UUID | None = Field(
        default=None,
        description="Provider connection that serves the reranking model.",
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    model_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)


class RerankerNode(PipelineNodeBase[RerankerConfig]):
    """Rerank every retrieved candidate through a configured provider model."""

    type = "reranker.model"
    label = "Reranker"
    category = "retrieval"
    description = "Re-score and reorder retrieved chunks using a configured provider model."
    example = "RetrievalPayload([chunk_b, chunk_a]) -> RetrievalPayload([chunk_a, chunk_b])."
    input_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    output_ports = (NodePort(key="results", label="Results", data_type="retrieval_results"),)
    config_model = RerankerConfig

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Flag a reranker that has no provider connection or model configured."""
        config = RerankerConfig.model_validate(node.config or {})
        issues: list[PipelineValidationIssue] = []
        if config.connection_id is None:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Reranker node '{node.id}' has no provider connection "
                        "configured. Pick one in the pipeline editor."
                    ),
                    severity="error",
                )
            )
        if not config.model_name:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Reranker node '{node.id}' has no reranking model "
                        "configured. Pick one in the pipeline editor."
                    ),
                    severity="error",
                )
            )
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Rerank every candidate, bypassing provider resolution for empty input."""
        payload = RetrievalPayload.model_validate(inputs.get("results"))
        candidates = payload.response.matches
        if not candidates:
            return {"results": payload}
        if context.query is None:
            raise ValueError("Reranker requires a query string in context.")
        if self.config.connection_id is None or not self.config.model_name:
            raise InvalidInputError(
                "Reranker node needs a provider connection and model. "
                "Pick them in the pipeline editor."
            )
        reranker = context.providers.reranker(
            self.config.connection_id,
            self.config.model_name,
        )
        matches = list(reranker.rerank(context.query, candidates))
        response = payload.response.model_copy(update={"matches": matches})
        return {"results": payload.model_copy(update={"response": response})}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize complete input and reranked output identities."""
        input_payload = RetrievalPayload.model_validate(inputs.get("results"))
        output_payload = RetrievalPayload.model_validate(outputs.get("results"))
        reranker_info = {
            "connection_id": (
                str(self.config.connection_id) if self.config.connection_id is not None else None
            ),
            "model_name": self.config.model_name,
        }
        original_items = trace_match_items(input_payload.response.matches)
        reranked_items = trace_match_items(output_payload.response.matches)
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Original order",
                    value=summarize_match_order(input_payload.response.matches),
                ),
                NodeTraceValue(label="Original items", value=original_items, kind="items"),
            ],
            outputs=[
                NodeTraceValue(label="Reranker", value=reranker_info),
                NodeTraceValue(
                    label="Reranked order",
                    value=summarize_match_order(output_payload.response.matches),
                ),
                NodeTraceValue(label="Reranked items", value=reranked_items, kind="items"),
            ],
        )
