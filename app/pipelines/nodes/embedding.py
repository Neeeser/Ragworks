"""Embedding node: provider-connection-backed embedder for item streams.

`embedder.text` is a facet-adding transform: it requires items with text,
stamps an embedding onto every item, and preserves whatever else the stream
carried — chunks, the query, or a re-embedded result set are all the same
wiring. The embedder itself comes from the run context's `ProviderResolver`,
so any connection with the EMBEDDING kind (OpenRouter, Ollama, ...) can
serve the node.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.embedding_guard import guard_items_for_embedding
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    TokenUsage,
    combine_usage,
    summarize_chunks,
    summarize_embeddings,
)
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.retrieval.embedders.base import Embedder
from app.services.errors import (
    InvalidInputError,
    ServiceError,
    is_external_provider_error,
)

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)


class EmbedderConfig(BaseModel):
    """Configuration for embedding nodes.

    `connection_id` names the provider connection that serves the model; both
    it and `model_name` are required for a runnable node, but stay optional on
    the model so an incomplete draft validates in the editor and surfaces
    through node validation instead of a parse crash.
    """

    connection_id: UUID | None = Field(
        default=None,
        description="Provider connection that serves the embedding model.",
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    model_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)
    dimension: int | None = Field(
        default=None,
        gt=0,
        description=(
            "Requested output dimension, for models that support reduced "
            "(Matryoshka-style) embeddings. Leave unset to store the model's "
            "native dimension — most embedding models only serve that size "
            "and error on an explicit request."
        ),
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    embed_as: Literal["auto", "documents", "query"] = Field(
        default="auto",
        description=(
            "Which side of an asymmetric embedding model the items go "
            "through. auto embeds items that belong to a document as "
            "documents and free-standing items (the query) as a query; pin "
            "it when a model distinguishes the two and auto guesses wrong."
        ),
    )


class EmbedderNode(PipelineNodeBase[EmbedderConfig]):
    """Stamp an embedding onto every item in the stream."""

    type = "embedder.text"
    label = "Embedder"
    category = "ingestion"
    description = "Embed each item's text using a configured provider connection."
    example = "Items(text='hello') -> Items(text='hello', embedding=[0.12, 0.03, ...])."
    input_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            requires=(Facet.TEXT,),
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            adds=(Facet.EMBEDDING,),
            preserves=True,
        ),
    )
    config_model = EmbedderConfig

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Flag an embedder that has no provider connection or model configured."""
        config = EmbedderConfig.model_validate(node.config or {})
        issues: list[PipelineValidationIssue] = []
        if config.connection_id is None:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Embedder node '{node.id}' has no provider connection "
                        "configured. Pick one in the pipeline editor."
                    ),
                    severity="error",
                )
            )
        if not config.model_name:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Embedder node '{node.id}' has no embedding model "
                        "configured. Pick one in the pipeline editor."
                    ),
                    severity="error",
                )
            )
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Embed every item's text and return the enriched stream."""
        raw = inputs.get("items")
        if raw is None:
            raise ValueError("Embedder node requires an items input.")
        batch = ItemBatch.model_validate(raw)
        if self.config.connection_id is None or not self.config.model_name:
            raise InvalidInputError(
                "Embedder node needs a provider connection and model. "
                "Pick them in the pipeline editor."
            )
        embedder = context.providers.embedder(
            self.config.connection_id,
            self.config.model_name,
            dimensions=self.config.dimension,
        )
        # Only document streams are guarded/split: cutting a query into
        # parts would change what is being asked, not just how it's batched.
        mode = self._resolve_mode(batch.items)
        guarded = self._guard_batch(batch, context) if mode == "documents" else batch
        embedded = self._embed_items(embedder, guarded.items, mode)
        # Usage accumulates along the stream: re-embedded items may already
        # carry provider accounting (a reranked result set), which this call's
        # own usage adds to rather than replaces.
        usage = combine_usage([batch.usage, TokenUsage.model_validate(embedder.usage or {})])
        return {
            "items": ItemBatch(
                items=embedded,
                tokenizer=guarded.tokenizer,
                usage=usage,
            )
        }

    def _embed_items(
        self,
        embedder: Embedder,
        items: list[Item],
        mode: Literal["documents", "query"],
    ) -> list[Item]:
        """Embed items through the document or query side of the model."""
        missing = [item.id for item in items if item.text is None]
        if missing:
            raise InvalidInputError(
                f"Embedder received {len(missing)} item(s) without text (first: '{missing[0]}')."
            )
        if mode == "query":
            embeddings = [embedder.embed_query(item.text or "") for item in items]
        else:
            embeddings = list(embedder.embed_documents([item.to_chunk() for item in items]))
            if len(embeddings) != len(items):
                raise ValueError("Embedder returned mismatched embeddings.")
        return [
            item.model_copy(update={"embedding": embedding})
            for item, embedding in zip(items, embeddings, strict=True)
        ]

    def _resolve_mode(self, items: list[Item]) -> Literal["documents", "query"]:
        """Resolve the embedding side: pinned by config, else by item identity."""
        if self.config.embed_as != "auto":
            return self.config.embed_as
        return "documents" if any(item.document_id is not None for item in items) else "query"

    def _guard_batch(self, batch: ItemBatch, context: PipelineRunContext) -> ItemBatch:
        """Split provider-bound items that exceed the model's effective limit."""
        if self.config.connection_id is None:  # guarded by run(), kept for type narrowing
            return batch
        published_limit = self._embedding_input_limit(context)
        return guard_items_for_embedding(batch, published_limit, context)

    def _embedding_input_limit(self, context: PipelineRunContext) -> int | None:
        """Resolve provider metadata, treating recognized lookup failures as unknown."""
        if self.config.connection_id is None:
            return None
        try:
            return context.providers.embedding_input_limit(
                self.config.connection_id,
                self.config.model_name,
            )
        except Exception as exc:
            if not isinstance(exc, ServiceError) and not is_external_provider_error(exc):
                raise
            logger.warning(
                "Embedding input limit unavailable for connection=%s model=%s: %s",
                self.config.connection_id,
                self.config.model_name,
                exc,
            )
            return None

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the textual input stream and the embedded output stream."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Item text",
                    value=summarize_chunks(input_batch.preview_chunks()),
                ),
                NodeTraceValue(
                    label="Input items", value=trace_items(input_batch.items), kind="items"
                ),
            ],
            outputs=[
                NodeTraceValue(
                    label="Embeddings",
                    value=summarize_embeddings(output_batch.preview_chunks()),
                    kind="embedding",
                ),
                NodeTraceValue(
                    label="Embedded items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
            ],
        )
