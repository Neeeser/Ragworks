"""Chunking nodes: a configurable-strategy node plus fixed-strategy variants."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal, TypeVar

from pydantic import BaseModel, Field, ValidationError, model_validator

from app.db.models import ChunkStrategy
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.partition import partition_items, partition_trace_value
from app.pipelines.payloads import Item, ItemBatch, TokenizerSpec, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_chunks
from app.pipelines.variables import expr_seed_extra
from app.retrieval.chunkers import build_chunker
from app.retrieval.models import Document
from app.retrieval.tokenizers.huggingface import validate_hf_model_id
from app.retrieval.tokenizers.resources import build_token_counter

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
    from app.pipelines.registry import NodeRegistry


#: Starting chunk size when nothing narrows it (recursive-512 benchmarks well).
DEFAULT_CHUNK_SIZE = 512
#: Overlap as a fraction of chunk size — the conventional ~20% recommendation.
#: Overlap is *added* to the size, so a chunk spans size * (1 + ratio) tokens.
#: The default overlap is derived from it rather than written as a literal, so
#: one number does not silently become a different proportion when the size
#: default moves, and the wizard and the node agree on what "default" means.
#: Mirrored by `CHUNK_OVERLAP_RATIO` in `frontend/src/lib/chunk-defaults.ts`.
CHUNK_OVERLAP_RATIO = 0.2
#: Default overlap in tokens. Overlap is stored and configured as a token
#: count everywhere; only the default is expressed as a proportion.
DEFAULT_CHUNK_OVERLAP = round(DEFAULT_CHUNK_SIZE * CHUNK_OVERLAP_RATIO)


def clamp_chunk_window(
    chunk_size: int, chunk_overlap: int, embedding_input_limit: int | None
) -> tuple[int, int]:
    """Fit the emitted chunk within a known embedding token budget.

    Overlap is added to `chunk_size`, so what reaches the embedder is their
    sum and the bound is ``chunk_size + chunk_overlap <= embedding_input_limit``.
    A window that already fits is left untouched; on shrink the overlap ratio
    is preserved, so a scaled-down window keeps the same proportion of repeated
    context rather than collapsing to none.
    """
    window = chunk_size + chunk_overlap
    if embedding_input_limit is None or window <= embedding_input_limit:
        return chunk_size, chunk_overlap
    if embedding_input_limit <= 1:
        return 1, 0
    # Scale both parts so size + overlap lands on the limit exactly.
    overlap_ratio = chunk_overlap / chunk_size if chunk_size else 0.0
    clamped_size = max(1, round(embedding_input_limit / (1 + overlap_ratio)))
    clamped_overlap = max(0, embedding_input_limit - clamped_size)
    return clamped_size, clamped_overlap


class FixedChunkerConfig(BaseModel):
    """Configuration for fixed-strategy chunking nodes."""

    chunk_size: int = Field(
        default=DEFAULT_CHUNK_SIZE,
        gt=0,
        description=(
            "New document text per chunk, counted by the selected tokenizer. "
            "Overlap is added on top, so each chunk sent to the embedder spans "
            "chunk_size + chunk_overlap tokens. Larger chunks keep more context "
            "around each match but dilute the embedding and eat into the "
            "model's input limit; smaller chunks match more precisely but "
            "fragment context."
        ),
    )
    chunk_overlap: int = Field(
        default=DEFAULT_CHUNK_OVERLAP,
        ge=0,
        # Seeded with `percent` rather than a bare multiplier: it says what it
        # means, and it is the form the editor's suggestion list can teach.
        json_schema_extra=expr_seed_extra(
            f"percent(self.chunk_size, {int(CHUNK_OVERLAP_RATIO * 100)})"
        ),
        description=(
            "Tokens repeated from the end of one chunk at the start of the "
            "next, so text straddling a boundary stays retrievable from both "
            "sides. Added on top of chunk size, not taken out of it, so the "
            "embedder receives chunk_size + chunk_overlap tokens and it is "
            f"that sum which must fit the model's input limit. Defaults to "
            f"{int(CHUNK_OVERLAP_RATIO * 100)}% of chunk size. The cost is "
            "index size — overlapped tokens are stored and embedded twice."
        ),
    )
    tokenizer: Literal["wordpiece", "cl100k", "whitespace", "huggingface"] = Field(
        default="wordpiece",
        description=(
            "Counter used to measure chunk_size and overlap. Match the "
            "embedding model's own tokenizer — wordpiece for BERT-family "
            "embedders, cl100k for OpenAI-family. whitespace counts words, "
            "not tokens, and undercounts by roughly 25%."
        ),
    )
    hf_model_id: str | None = Field(
        default=None,
        description=(
            "HuggingFace model id whose tokenizer to download and count with. "
            "Only used (and required) when tokenizer is huggingface."
        ),
    )

    @model_validator(mode="after")
    def validate_tokenizer_config(self) -> FixedChunkerConfig:
        """Require a safe model id only for HuggingFace tokenizers."""
        if self.tokenizer == "huggingface":
            if self.hf_model_id is None:
                raise ValueError("A HuggingFace tokenizer requires a model id.")
            self.hf_model_id = validate_hf_model_id(self.hf_model_id)
        elif self.hf_model_id is not None:
            raise ValueError("Only a HuggingFace tokenizer accepts a model id.")
        return self


FixedConfigT = TypeVar("FixedConfigT", bound=FixedChunkerConfig)


class BaseChunkerNode(PipelineNodeBase[FixedConfigT]):
    """Shared run/summarize behavior for every chunker node.

    Fixed-strategy subclasses (`TokenChunkerNode`, `SentenceChunkerNode`, ...)
    set a class-level `strategy` and use `FixedChunkerConfig` unchanged.
    `ChunkerNode` (below) instead exposes `strategy` as a configurable field
    on its own `ChunkerConfig` and overrides `_resolve_strategy` to read it
    from there -- that's the only difference between the two shapes, so it's
    the only method either needs to override.
    """

    input_ports = (
        NodePort(
            key="items",
            label="Items",
            data_type=PortKind.ITEMS,
            accepts=(Facet.TEXT,),
            unaccepted="passthrough",
        ),
    )
    output_ports = (
        # A chunk is built from a slice of its source item's text, so the
        # source's vector and score describe none of them; the items that
        # bypassed chunking keep theirs.
        NodePort(
            key="items",
            label="Chunks",
            data_type=PortKind.ITEMS,
            adds=(Facet.TEXT,),
            preserves=True,
            removes=(Facet.EMBEDDING, Facet.SCORE),
        ),
    )
    config_model = FixedChunkerConfig
    strategy: ChunkStrategy = ChunkStrategy.TOKEN

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Return field-addressable issues for invalid chunker config."""
        try:
            cls.config_model.model_validate(node.config or {})
        except ValidationError as exc:
            issues: list[PipelineValidationIssue] = []
            for error in exc.errors():
                location = error["loc"]
                field = str(location[0]) if location else "hf_model_id"
                if field in {"tokenizer", "hf_model_id"}:
                    message = f"Node '{node.display_name}' has an invalid tokenizer configuration."
                else:
                    message = (
                        f"Node '{node.display_name}' has an invalid value for '{field}': {error['msg']}."
                    )
                issues.append(
                    PipelineValidationIssue(
                        message=message,
                        node_id=node.id,
                        field=field,
                    )
                )
            return issues
        return []

    def _resolve_strategy(self) -> ChunkStrategy:
        """Return the chunking strategy to use for this node instance."""
        return self.strategy

    def tokenizer_spec(self) -> TokenizerSpec:
        """Build the immutable tokenizer selection from this node's config."""
        return TokenizerSpec(kind=self.config.tokenizer, hf_model_id=self.config.hf_model_id)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Split the textual items into chunks; pass every other item through."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        partition = partition_items(batch.items, self.input_ports[0])
        tokenizer = self.tokenizer_spec()
        counter = build_token_counter(tokenizer, context.storage.base_path)
        chunker = build_chunker(
            self._resolve_strategy(),
            self.config.chunk_size,
            self.config.chunk_overlap,
            counter=counter,
        )
        chunked: list[Item] = []
        for item in partition.accepted:
            # Chunk ids key off the source item's id, so a document's chunks
            # stay `{document_id}:{n}` — the shape vector ids and
            # per-document deletion are built on.
            document = Document(
                document_id=item.id,
                text=item.text or "",
                metadata=item.metadata.model_copy(deep=True),
            )
            chunked.extend(
                Item.from_chunk(chunk).model_copy(update={"document_id": item.document_id})
                for chunk in chunker.chunk(document)
            )
        logger.info(
            "Pipeline chunker=%s produced %s chunks from %s items",
            chunker.__class__.__name__,
            len(chunked),
            len(partition.accepted),
        )
        return {
            "items": batch.model_copy(
                update={"items": partition.merge(chunked), "tokenizer": tokenizer}
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize chunking inputs and outputs."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Input items", value=trace_items(input_batch.items), kind="items"
                ),
                partition_trace_value(
                    partition_items(input_batch.items, self.input_ports[0]), label="Not chunked"
                ),
            ],
            outputs=[
                NodeTraceValue(
                    label="Chunks",
                    value=summarize_chunks(output_batch.preview_chunks()),
                ),
                NodeTraceValue(
                    label="Chunk items", value=trace_items(output_batch.items), kind="items"
                ),
            ],
        )


class TokenChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on tokens."""

    type = "chunker.token"
    label = "Token Chunker"
    category = "ingestion"
    description = "Chunk documents based on token counts."
    example = "Items(1 text) -> Items(['Hello', 'world'])."
    strategy = ChunkStrategy.TOKEN


class SentenceChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on sentences."""

    type = "chunker.sentence"
    label = "Sentence Chunker"
    category = "ingestion"
    description = "Chunk documents using sentence boundaries."
    example = "Items(1 text) -> Items(['Hello world.', 'Another sentence.'])."
    strategy = ChunkStrategy.SENTENCE


class ParagraphChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on paragraphs."""

    type = "chunker.paragraph"
    label = "Paragraph Chunker"
    category = "ingestion"
    description = "Chunk documents using paragraph boundaries."
    example = "Items(1 text) -> Items(['Para 1.', 'Para 2.'])."
    strategy = ChunkStrategy.PARAGRAPH


class SemanticChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on semantic boundaries."""

    type = "chunker.semantic"
    label = "Semantic Chunker"
    category = "ingestion"
    description = "Chunk documents using semantic similarity."
    example = "Items(1 text) -> Items(['Topic A...', 'Topic B...'])."
    strategy = ChunkStrategy.SEMANTIC


class ChunkerConfig(FixedChunkerConfig):
    """Configuration for the configurable-strategy chunker node."""

    strategy: ChunkStrategy = ChunkStrategy.TOKEN


class ChunkerNode(BaseChunkerNode[ChunkerConfig]):
    """Split documents into smaller chunks using a configurable strategy."""

    type = "chunker.collection"
    label = "Chunker"
    category = "ingestion"
    description = "Chunk documents using the node configuration."
    example = "Items(1 text) -> Items(['Hello', 'world'])."
    config_model = ChunkerConfig
    # Internal configurable variant; the editor catalog offers the fixed-strategy
    # chunkers instead.
    hidden = True

    def _resolve_strategy(self) -> ChunkStrategy:
        """Read the chunking strategy from the node's own config."""
        return self.config.strategy
