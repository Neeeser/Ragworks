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
from app.pipelines.payloads import Item, ItemBatch, TokenizerSpec, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    TokenUsage,
    summarize_chunks,
    summarize_embeddings,
)
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.providers.base import effective_embedding_input_limit
from app.retrieval.embedders.base import Embedder
from app.retrieval.tokenizers.resources import build_token_counter
from app.services.errors import (
    InvalidInputError,
    ServiceError,
    is_external_provider_error,
)

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)


def _rekey_split_items(parts_by_item: list[tuple[Item, list[str]]]) -> list[Item]:
    """Re-key a batch whose oversized items were split into parts.

    Document-owned batches renumber to the canonical `{document_id}:{order}`
    scheme so vector ids and per-document deletion stay consistent;
    free-standing items keep their id, with a `#part` suffix when split.
    """
    renumber = all(item.document_id is not None for item, _ in parts_by_item)
    rekeyed: list[Item] = []
    for item, parts in parts_by_item:
        for part_index, text in enumerate(parts):
            if renumber:
                order = len(rekeyed)
                item_id = f"{item.document_id}:{order}"
            else:
                order = item.order if item.order is not None else len(rekeyed)
                item_id = item.id if len(parts) == 1 else f"{item.id}#{part_index}"
            rekeyed.append(
                item.model_copy(
                    update={
                        "id": item_id,
                        "text": text,
                        "order": order,
                        "metadata": item.metadata.model_copy(deep=True),
                    }
                )
            )
    return rekeyed


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
        usage = TokenUsage.model_validate(embedder.usage or {})
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
                f"Embedder received {len(missing)} item(s) without text "
                f"(first: '{missing[0]}')."
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
        return self.guard_items_for_embedding(batch, published_limit, context)

    @staticmethod
    def guard_items_for_embedding(
        batch: ItemBatch,
        published_limit: int | None,
        context: PipelineRunContext,
    ) -> ItemBatch:
        """Split oversized textual items once before they fan out to index planes.

        Split parts of a document-owned item are re-keyed to the canonical
        `{document_id}:{order}` scheme (the whole batch renumbers, so vector
        ids and per-document deletion stay consistent); free-standing items
        keep their id with a `#part` suffix.
        """
        if published_limit is None:
            return batch
        limit = effective_embedding_input_limit(published_limit)
        if limit <= 0:
            return batch

        # A whitespace tokenizer is useful for legacy chunking, but it is not
        # an estimate of model tokens. The runtime guard must use a real model
        # tokenizer whenever the configured tokenizer cannot enforce the provider's
        # limit, otherwise providers may still silently truncate the parts.
        tokenizer = batch.tokenizer or TokenizerSpec(kind="wordpiece")
        if tokenizer.kind == "whitespace":
            tokenizer = TokenizerSpec(kind="wordpiece")
        counter = build_token_counter(tokenizer, context.storage.base_path)

        split_any = False
        parts_by_item: list[tuple[Item, list[str]]] = []
        for original_index, item in enumerate(batch.items):
            text = item.text or ""
            token_count = counter.count(text)
            # Overlap is added to chunk_size, so the size passed here has to
            # leave room for it — splitting at the full limit plus an overlap
            # would emit parts over the very limit this guard enforces.
            guard_overlap = min(32, max(0, limit - 1))
            if token_count > limit:
                parts = counter.split(
                    text,
                    chunk_size=max(1, limit - guard_overlap),
                    overlap=guard_overlap,
                )
                split_any = True
                warning = (
                    f"Item '{item.id}' (index {original_index}) contained "
                    f"{token_count} tokens, exceeding the {limit}-token embedding limit, "
                    f"and was split into {len(parts)} parts using the {tokenizer.kind} counter."
                )
                if context.trace is not None:
                    context.trace.record_warning(warning)
            else:
                parts = [text]
            parts_by_item.append((item, parts))
        if not split_any:
            return batch
        return batch.model_copy(update={"items": _rekey_split_items(parts_by_item)})

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
