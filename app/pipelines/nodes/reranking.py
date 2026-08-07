"""Provider-backed pipeline node for reranking retrieved chunks."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.image_assets import load_inline_media
from app.pipelines.model_modality_rules import (
    ModelModalityRule,
    accepted_facets,
    published_facets,
)
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_match_order
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.retrieval.models import RerankCandidate
from app.schemas.enums import ProviderKind
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
            requires=(Facet.SCORE,),
            accepts=(Facet.TEXT,),
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
    model_modality = ModelModalityRule(kind=ProviderKind.RERANKING, follows_model=True)

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
                    node_id=node.id,
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
                    node_id=node.id,
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
        candidates = self._candidates(batch.items, context)
        matches = list(reranker.rerank(context.query, candidates))
        return {
            "items": batch.model_copy(
                update={"items": [Item.from_match(match) for match in matches]}
            )
        }

    def resolve_accepts(self, context: PipelineRunContext) -> frozenset[str]:
        """Return the facets this node's configured reranking model can score."""
        floor = frozenset({Facet.TEXT})
        if self.config.connection_id is None:
            return floor
        published = published_facets(
            context.providers,
            self.config.connection_id,
            self.config.model_name,
            ProviderKind.RERANKING,
        )
        return accepted_facets(published, floor)

    def _candidates(
        self, items: list[Item], context: PipelineRunContext
    ) -> list[RerankCandidate]:
        """Pair every match with the image it stands for, when the model reads images.

        The bytes are only loaded for a model that can score them: for a
        text-only model the image is left off, and the reranker refuses
        the stream rather than ranking the placeholder text an image
        chunk is stored under.
        """
        visual = [item for item in items if item.image is not None]
        if not visual or Facet.IMAGE not in self.resolve_accepts(context):
            return [RerankCandidate(match=item.to_match()) for item in items]
        return [
            RerankCandidate(
                match=item.to_match(),
                image=(
                    None
                    if item.image is None
                    else load_inline_media(
                        context.storage,
                        media_type=item.image.media_type,
                        path=item.image.path,
                    )
                ),
            )
            for item in items
        ]

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
