"""Provider-backed pipeline node for reranking retrieved chunks."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_match_order
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
    example = "Items([chunk_b, chunk_a]) -> Items([chunk_a, chunk_b])."
    input_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            requires=(Facet.TEXT, Facet.SCORE),
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
        batch = ItemBatch.model_validate(inputs.get("items"))
        if not batch.items:
            return {"items": batch}
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
        matches = list(reranker.rerank(context.query, batch.to_matches()))
        return {
            "items": batch.model_copy(
                update={"items": [Item.from_match(match) for match in matches]}
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize complete input and reranked output identities."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        reranker_info = {
            "connection_id": (
                str(self.config.connection_id) if self.config.connection_id is not None else None
            ),
            "model_name": self.config.model_name,
        }
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
                NodeTraceValue(label="Reranker", value=reranker_info),
                NodeTraceValue(
                    label="Reranked order",
                    value=summarize_match_order(output_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Reranked items", value=trace_items(output_batch.items), kind="items"
                ),
            ],
        )
