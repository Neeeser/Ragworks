"""Embedding node: provider-connection-backed embedder for item streams.

`embedder.text` is a facet-adding transform: it stamps an embedding onto
every item its model can read and preserves whatever else the stream
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
from app.pipelines.model_modality import (
    ModelModalityRule,
    accepted_facets,
    published_facets,
)
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.embedding_guard import guard_items_for_embedding
from app.pipelines.partition import ItemPartition, partition_items
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
from app.retrieval.models import EmbeddingVector
from app.schemas.enums import ProviderKind
from app.schemas.media import InlineMedia
from app.services.errors import (
    InvalidInputError,
    ServiceError,
    is_external_provider_error,
)
from app.utils.file_storage import FileStorage

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
    """Stamp an embedding onto every item the selected model can read.

    What the node accepts is the model's property, not the node's: an
    embedding model whose catalog publishes image input embeds image items
    in the same vector space as its text, and the same node with a
    text-only model leaves them untouched for a later branch to handle.
    The declared `accepts` is the floor every embedding model meets;
    `resolve_accepts` widens it per configured model.
    """

    type = "embedder.text"
    label = "Embedder"
    category = "ingestion"
    description = "Embed each item using a configured provider connection."
    example = "Items(text='hello') -> Items(text='hello', embedding=[0.12, 0.03, ...])."
    input_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            accepts=(Facet.TEXT,),
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
    model_modality = ModelModalityRule(kind=ProviderKind.EMBEDDING, follows_model=True)

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

    def resolve_accepts(self, context: PipelineRunContext) -> frozenset[str]:
        """Return the facets this node's configured model can embed."""
        floor = frozenset({Facet.TEXT})
        if self.config.connection_id is None:
            return floor
        published = published_facets(
            context.providers,
            self.config.connection_id,
            self.config.model_name,
            ProviderKind.EMBEDDING,
        )
        return accepted_facets(published, floor)

    def _partition(self, items: list[Item], context: PipelineRunContext) -> ItemPartition:
        """Split the stream, asking the catalog only when it could matter.

        Every embedding model embeds text, so a stream the floor already
        accepts in full needs no catalog lookup — which keeps the common
        text-only pipeline free of a provider round-trip on the query
        path. Only items the floor left out raise the question of whether
        this particular model reads them.
        """
        partition = partition_items(items, self.input_ports[0])
        if not partition.unaccepted:
            return partition
        return partition_items(items, self.input_ports[0], accepts=self.resolve_accepts(context))

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Embed every item the model can read and return the enriched stream."""
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
        partition = self._partition(guarded.items, context)
        embedded = self._embed_items(embedder, list(partition.accepted), mode)
        # Usage accumulates along the stream: re-embedded items may already
        # carry provider accounting (a reranked result set), which this call's
        # own usage adds to rather than replaces.
        usage = combine_usage([batch.usage, TokenUsage.model_validate(embedder.usage or {})])
        return {
            "items": ItemBatch(
                items=partition.merge(embedded),
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
        """Embed items through the model, by what each one carries.

        Items with text embed through the model's document or query side;
        items carrying only an image go through its image surface. An item
        with both is embedded from its text, which is the richer signal
        once a describe step has run.
        """
        textual = [item for item in items if item.text is not None]
        visual = [item for item in items if item.text is None]
        vectors: dict[str, EmbeddingVector] = {}
        if mode == "query":
            for item in textual:
                vectors[item.id] = embedder.embed_query(item.text or "")
        elif textual:
            embeddings = list(embedder.embed_documents([item.to_chunk() for item in textual]))
            if len(embeddings) != len(textual):
                raise ValueError("Embedder returned mismatched embeddings.")
            vectors.update(zip((item.id for item in textual), embeddings, strict=True))
        if visual:
            image_vectors = self._embed_images(embedder, visual)
            vectors.update(zip((item.id for item in visual), image_vectors, strict=True))
        return [item.model_copy(update={"embedding": vectors[item.id]}) for item in items]

    @staticmethod
    def _embed_images(embedder: Embedder, items: list[Item]) -> list[EmbeddingVector]:
        """Embed the image assets of items that carry no text."""
        storage = FileStorage()
        media = [
            InlineMedia(media_type=item.image.media_type, data=storage.read_bytes(item.image.path))
            for item in items
            if item.image is not None
        ]
        embeddings = list(embedder.embed_images(media))
        if len(embeddings) != len(items):
            raise ValueError("Embedder returned mismatched image embeddings.")
        return embeddings

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
