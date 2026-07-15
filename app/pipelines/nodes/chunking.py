"""Chunking nodes: a configurable-strategy node plus fixed-strategy variants."""

from __future__ import annotations

import logging
from typing import TypeVar

from pydantic import BaseModel, Field

from app.db.models import ChunkStrategy
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.payloads import ChunkPayload, ParsedDocumentPayload, TokenizerSpec
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_chunks, summarize_text
from app.retrieval.chunkers import build_chunker
from app.retrieval.tokenizers.resources import build_token_counter

logger = logging.getLogger(__name__)


class FixedChunkerConfig(BaseModel):
    """Configuration for fixed-strategy chunking nodes."""

    chunk_size: int = Field(default=512, gt=0)
    chunk_overlap: int = Field(default=200, ge=0)


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
        NodePort(key="document", label="Document", data_type="document"),
        NodePort(
            key="tokenizer",
            label="Tokenizer",
            data_type="tokenizer",
            required=False,
        ),
    )
    output_ports = (NodePort(key="chunks", label="Chunks", data_type="chunk_batch"),)
    config_model = FixedChunkerConfig
    strategy: ChunkStrategy = ChunkStrategy.TOKEN

    def _resolve_strategy(self) -> ChunkStrategy:
        """Return the chunking strategy to use for this node instance."""
        return self.strategy

    @staticmethod
    def resolve_tokenizer(inputs: dict[str, object]) -> TokenizerSpec:
        """Read the optional resource input, defaulting to bundled WordPiece."""
        value = inputs.get("tokenizer")
        return TokenizerSpec.model_validate(value) if value is not None else TokenizerSpec(
            kind="wordpiece"
        )

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Chunk a parsed document into segments."""
        payload = ParsedDocumentPayload.model_validate(inputs.get("document"))
        document = payload.document

        tokenizer = self.resolve_tokenizer(inputs)
        counter = build_token_counter(tokenizer, context.storage.base_path)
        chunker = build_chunker(
            self._resolve_strategy(),
            self.config.chunk_size,
            self.config.chunk_overlap,
            counter=counter,
        )
        chunks = list(chunker.chunk(document))
        logger.info(
            "Pipeline chunker=%s produced %s chunks for document %s",
            chunker.__class__.__name__,
            len(chunks),
            document.document_id,
        )
        return {"chunks": ChunkPayload(document=document, chunks=chunks)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize chunking inputs and outputs."""
        input_payload = ParsedDocumentPayload.model_validate(inputs.get("document"))
        output_payload = ChunkPayload.model_validate(outputs.get("chunks"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Document",
                    value=summarize_text(input_payload.document.text),
                    kind="text",
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Chunks",
                    value=summarize_chunks(output_payload.chunks),
                )
            ],
        )


class TokenChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on tokens."""

    type = "chunker.token"
    label = "Token Chunker"
    category = "ingestion"
    description = "Chunk documents based on token counts."
    example = "ParsedDocumentPayload(text='Hello world') -> ChunkPayload(chunks=['Hello', 'world'])."
    strategy = ChunkStrategy.TOKEN


class SentenceChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on sentences."""

    type = "chunker.sentence"
    label = "Sentence Chunker"
    category = "ingestion"
    description = "Chunk documents using sentence boundaries."
    example = (
        "ParsedDocumentPayload(text='Hello world. Another sentence.') -> "
        "ChunkPayload(chunks=['Hello world.', 'Another sentence.'])."
    )
    strategy = ChunkStrategy.SENTENCE


class ParagraphChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on paragraphs."""

    type = "chunker.paragraph"
    label = "Paragraph Chunker"
    category = "ingestion"
    description = "Chunk documents using paragraph boundaries."
    example = (
        "ParsedDocumentPayload(text='Para 1.\\n\\nPara 2.') -> "
        "ChunkPayload(chunks=['Para 1.', 'Para 2.'])."
    )
    strategy = ChunkStrategy.PARAGRAPH


class SemanticChunkerNode(BaseChunkerNode[FixedChunkerConfig]):
    """Chunk documents based on semantic boundaries."""

    type = "chunker.semantic"
    label = "Semantic Chunker"
    category = "ingestion"
    description = "Chunk documents using semantic similarity."
    example = (
        "ParsedDocumentPayload(text='Topic A... Topic B...') -> "
        "ChunkPayload(chunks=['Topic A...', 'Topic B...'])."
    )
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
    example = "ParsedDocumentPayload(text='Hello world') -> ChunkPayload(chunks=['Hello', 'world'])."
    config_model = ChunkerConfig
    # Internal configurable variant; the editor catalog offers the fixed-strategy
    # chunkers instead.
    hidden = True

    def _resolve_strategy(self) -> ChunkStrategy:
        """Read the chunking strategy from the node's own config."""
        return self.config.strategy
