"""Pipeline nodes for document ingestion."""

# pylint: disable=duplicate-code

from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.api.config import get_settings
from app.db.models import ChunkStrategy
from app.pipelines.payloads import (
    ChunkPayload,
    EmbeddingPayload,
    IndexingPayload,
    ParsedDocumentPayload,
    SourcePayload,
)
from app.pipelines.nodes.trace_utils import (
    summarize_chunks,
    summarize_embeddings,
    summarize_source,
    summarize_text,
)
from app.pipelines.models import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.runtime import (
    NodePort,
    PipelineNodeBase,
    PipelineRunContext,
    PipelineValidationIssue,
)
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.retrieval.embedders.openrouter_embedder import OpenRouterEmbedder
from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig, PineconeIndexer
from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers.base import DocumentParser, DocumentSource
from app.retrieval.parsers.pdf import PdfToTextParser
from app.retrieval.parsers.txt import TxtDocumentParser
from app.services.chunking import build_chunker
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE, resolve_collection_template

logger = logging.getLogger(__name__)
settings = get_settings()


class IngestionInputConfig(BaseModel):
    """Configuration for ingestion input nodes."""


class IngestionInputNode(PipelineNodeBase):
    """Load a document source from the current ingestion context."""

    type = "ingestion.input"
    label = "Ingestion Input"
    category = "ingestion"
    description = "Build a document source from the uploaded file."
    example = (
        "Context(document='file.pdf') -> "
        "SourcePayload(document_id='123', path='/tmp/file.pdf', "
        "content_type='application/pdf')."
    )
    input_ports = []
    output_ports = [NodePort(key="source", label="Source", data_type="document_source")]
    config_model = IngestionInputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Return the DocumentSource for the ingestion run."""
        if context.document is None:
            raise ValueError("Ingestion context is missing a document record.")
        if not context.document.source_path:
            raise ValueError("Document source path is not set for ingestion.")
        metadata = DocumentMetadata(
            data={
                "collection_id": str(context.collection.id),
                "document_id": str(context.document.id),
                "filename": context.document.name,
            }
        )
        source = DocumentSource(
            document_id=str(context.document.id),
            path=Path(context.document.source_path),
            content_type=context.document.content_type,
            metadata=metadata,
        )
        return {"source": SourcePayload(source=source)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the ingestion source payload."""
        payload = SourcePayload.model_validate(outputs.get("source"))
        return NodeTraceSummary(
            outputs=[
                NodeTraceValue(
                    label="Source",
                    value=summarize_source(payload.source),
                )
            ]
        )


class ParserConfig(BaseModel):
    """Configuration for document parsing."""

    mode: Literal["auto", "pdf", "text"] = "auto"
    encoding: str = "utf-8"


class DocumentParserNode(PipelineNodeBase):
    """Parse uploaded documents into normalized text."""

    type = "parser.document"
    label = "Document Parser"
    category = "ingestion"
    description = "Extract text from a document source."
    example = (
        "SourcePayload(content_type='application/pdf') -> "
        "ParsedDocumentPayload(text='Invoice #42 ...')."
    )
    input_ports = [NodePort(key="source", label="Source", data_type="document_source")]
    output_ports = [NodePort(key="document", label="Document", data_type="document")]
    config_model = ParserConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Parse a source payload into a document."""
        payload = SourcePayload.model_validate(inputs.get("source"))
        source = payload.source

        parser = self._resolve_parser(source.content_type)
        logger.info(
            "Pipeline parser=%s document_id=%s content_type=%s",
            parser.__class__.__name__,
            source.document_id,
            source.content_type,
        )
        document = parser.parse(source)
        return {"document": ParsedDocumentPayload(document=document)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize document parsing inputs and outputs."""
        source_payload = SourcePayload.model_validate(inputs.get("source"))
        document_payload = ParsedDocumentPayload.model_validate(outputs.get("document"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Source",
                    value=summarize_source(source_payload.source),
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Text",
                    value=summarize_text(document_payload.document.text),
                    kind="text",
                )
            ],
        )

    def _resolve_parser(self, content_type: Optional[str]) -> DocumentParser:
        """Select a parser based on configuration and content type."""
        if self.config.mode == "pdf":
            return PdfToTextParser()
        if self.config.mode == "text":
            return TxtDocumentParser(encoding=self.config.encoding)
        if content_type and "pdf" in content_type:
            return PdfToTextParser()
        return TxtDocumentParser(encoding=self.config.encoding)


class FileTypeRouterConfig(BaseModel):
    """Configuration for file type routing."""

    pdf_label: str = "pdf"
    text_label: str = "text"
    other_label: str = "other"


class FileTypeRouterNode(PipelineNodeBase):
    """Route sources based on content type."""

    type = "router.file_type"
    label = "File Type Router"
    category = "ingestion"
    description = "Branch the pipeline based on the file content type."
    example = (
        "SourcePayload(content_type='application/pdf') -> "
        "{pdf: SourcePayload(...)}."
    )
    input_ports = [NodePort(key="source", label="Source", data_type="document_source")]
    output_ports = [
        NodePort(key="pdf", label="PDF", data_type="document_source", required=False),
        NodePort(key="text", label="Text", data_type="document_source", required=False),
        NodePort(key="other", label="Other", data_type="document_source", required=False),
    ]
    config_model = FileTypeRouterConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Return the source on the appropriate output port."""
        payload = SourcePayload.model_validate(inputs.get("source"))
        source = payload.source
        content_type = (source.content_type or "").lower()
        if "pdf" in content_type:
            return {"pdf": payload}
        if "text" in content_type or "plain" in content_type:
            return {"text": payload}
        return {"other": payload}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize how the document was routed."""
        source_payload = SourcePayload.model_validate(inputs.get("source"))
        route = next(iter(outputs.keys()), "unknown")
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Source",
                    value=summarize_source(source_payload.source),
                )
            ],
            outputs=[NodeTraceValue(label="Route", value=route)],
        )


class ChunkerConfig(BaseModel):
    """Configuration for chunking documents."""

    strategy: ChunkStrategy = ChunkStrategy.TOKEN
    chunk_size: int = Field(default=1024, gt=0)
    chunk_overlap: int = Field(default=200, ge=0)


class ChunkerNode(PipelineNodeBase):
    """Split documents into smaller chunks."""

    type = "chunker.collection"
    label = "Chunker"
    category = "ingestion"
    description = "Chunk documents using the node configuration."
    example = (
        "ParsedDocumentPayload(text='Hello world') -> "
        "ChunkPayload(chunks=['Hello', 'world'])."
    )
    input_ports = [NodePort(key="document", label="Document", data_type="document")]
    output_ports = [NodePort(key="chunks", label="Chunks", data_type="chunk_batch")]
    config_model = ChunkerConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Chunk a parsed document into segments."""
        payload = ParsedDocumentPayload.model_validate(inputs.get("document"))
        document = payload.document

        chunker = build_chunker(
            self.config.strategy,
            self.config.chunk_size,
            self.config.chunk_overlap,
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


class FixedChunkerConfig(BaseModel):
    """Configuration for fixed-strategy chunking nodes."""

    chunk_size: int = Field(default=1024, gt=0)
    chunk_overlap: int = Field(default=200, ge=0)


class BaseChunkerNode(PipelineNodeBase):
    """Base class for fixed-strategy chunkers."""

    input_ports = [NodePort(key="document", label="Document", data_type="document")]
    output_ports = [NodePort(key="chunks", label="Chunks", data_type="chunk_batch")]
    config_model = FixedChunkerConfig
    strategy: ChunkStrategy = ChunkStrategy.TOKEN

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Chunk a parsed document into segments."""
        payload = ParsedDocumentPayload.model_validate(inputs.get("document"))
        document = payload.document

        chunker = build_chunker(
            self.strategy,
            self.config.chunk_size,
            self.config.chunk_overlap,
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


class TokenChunkerNode(BaseChunkerNode):
    """Chunk documents based on tokens."""

    type = "chunker.token"
    label = "Token Chunker"
    category = "ingestion"
    description = "Chunk documents based on token counts."
    example = (
        "ParsedDocumentPayload(text='Hello world') -> "
        "ChunkPayload(chunks=['Hello', 'world'])."
    )
    strategy = ChunkStrategy.TOKEN


class SentenceChunkerNode(BaseChunkerNode):
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


class ParagraphChunkerNode(BaseChunkerNode):
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


class SemanticChunkerNode(BaseChunkerNode):
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


class EmbedderConfig(BaseModel):
    """Configuration for embedding nodes."""

    model_name: str = Field(default_factory=lambda: settings.default_embedding_model)
    dimension: Optional[int] = Field(
        default=None,
        gt=0,
        description="Optional override for the embedding vector dimension.",
    )


class EmbedderNode(PipelineNodeBase):
    """Generate embeddings for document chunks."""

    type = "embedder.openrouter"
    label = "Embedder"
    category = "ingestion"
    description = "Embed chunks using OpenRouter."
    example = (
        "ChunkPayload(chunks=['hello']) -> "
        "EmbeddingPayload(embeddings=[[0.12, 0.03, ...]])."
    )
    input_ports = [NodePort(key="chunks", label="Chunks", data_type="chunk_batch")]
    output_ports = [NodePort(key="embedded", label="Embedded", data_type="embedded_batch")]
    config_model = EmbedderConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Embed chunk payloads with OpenRouter."""
        payload = ChunkPayload.model_validate(inputs.get("chunks"))
        document = payload.document
        chunks = payload.chunks

        embedder = OpenRouterEmbedder(
            context.openrouter,
            self.config.model_name,
            dimensions=self.config.dimension,
        )
        embeddings = embedder.embed_documents(chunks)
        if len(embeddings) != len(chunks):
            raise ValueError("Embedder returned mismatched embeddings.")
        enriched_chunks = [
            chunk.with_embedding(embedding)
            for chunk, embedding in zip(chunks, embeddings)
        ]
        usage = embedder.usage or {}
        return {
            "embedded": EmbeddingPayload(
                document=document,
                chunks=enriched_chunks,
                usage=usage,
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize embedding inputs and outputs."""
        input_payload = ChunkPayload.model_validate(inputs.get("chunks"))
        output_payload = EmbeddingPayload.model_validate(outputs.get("embedded"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Chunk text",
                    value=summarize_chunks(input_payload.chunks),
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Embeddings",
                    value=summarize_embeddings(output_payload.chunks),
                    kind="embedding",
                )
            ],
        )


class IndexerConfig(BaseModel):
    """Configuration for indexing nodes."""

    index_name: str = Field(default_factory=lambda: settings.pinecone_index_name)
    namespace: str = Field(default=DEFAULT_NAMESPACE_TEMPLATE)
    dimension: Optional[int] = Field(default=None, gt=0)
    metric: str = "cosine"
    ensure_index: bool = True


class IndexerNode(PipelineNodeBase):
    """Upsert embedded chunks into Pinecone."""

    type = "indexer.pinecone"
    label = "Indexer"
    category = "ingestion"
    description = "Upsert embeddings into Pinecone."
    example = (
        "EmbeddingPayload(chunks=2) -> "
        "IndexingPayload(chunks=2, index='pinecone')."
    )
    input_ports = [NodePort(key="embedded", label="Embedded", data_type="embedded_batch")]
    output_ports = [NodePort(key="indexed", label="Indexed", data_type="indexed_batch")]
    config_model = IndexerConfig

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        definition: PipelineDefinition,
        _registry: "NodeRegistry",
    ) -> list[PipelineValidationIssue]:
        """Validate embedder/indexer dimension compatibility."""
        issues: list[PipelineValidationIssue] = []
        incoming_edges = definition.incoming_edges().get(node.id, [])
        if not incoming_edges:
            return issues
        node_map = definition.node_map()
        indexer_config = IndexerConfig.model_validate(node.config or {})
        for edge in incoming_edges:
            source_def = node_map.get(edge.source)
            if not source_def or source_def.type != "embedder.openrouter":
                continue
            embedder_config = EmbedderConfig.model_validate(source_def.config or {})
            embedder_dim = embedder_config.dimension
            indexer_dim = indexer_config.dimension
            if embedder_dim and indexer_dim and embedder_dim != indexer_dim:
                issues.append(
                    PipelineValidationIssue(
                        message=(
                            f"Indexer node '{node.id}' dimension {indexer_dim} does not "
                            f"match embedder '{source_def.id}' dimension {embedder_dim}."
                        ),
                        severity="error",
                    )
                )
            elif embedder_dim and not indexer_dim:
                issues.append(
                    PipelineValidationIssue(
                        message=(
                            f"Indexer node '{node.id}' has no dimension configured; ensure it "
                            f"matches embedder '{source_def.id}' dimension {embedder_dim}."
                        ),
                        severity="warning",
                    )
                )
            elif indexer_dim and not embedder_dim:
                issues.append(
                    PipelineValidationIssue(
                        message=(
                            f"Embedder node '{source_def.id}' has no dimension configured; "
                            f"ensure it matches indexer '{node.id}' dimension {indexer_dim}."
                        ),
                        severity="warning",
                    )
                )
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Upsert embedded chunks into Pinecone."""
        payload = EmbeddingPayload.model_validate(inputs.get("embedded"))
        document = payload.document
        chunks = payload.chunks

        dimension = self.config.dimension
        if dimension is None:
            if not chunks or chunks[0].embedding is None:
                raise ValueError("Indexer dimension could not be inferred from embeddings.")
            dimension = len(chunks[0].embedding)
        namespace = resolve_collection_template(self.config.namespace, context.collection)
        index_name = resolve_collection_template(self.config.index_name, context.collection)

        index_config = PineconeIndexConfig(
            name=index_name,
            namespace=namespace,
            dimension=int(dimension),
            metric=self.config.metric,
        )
        indexer = PineconeIndexer(client=context.pinecone)
        if self.config.ensure_index:
            indexer.ensure_index(index_config)
        indexer.upsert(config=index_config, chunks=chunks, namespace=namespace)
        return {
            "indexed": IndexingPayload(
                document=document,
                chunks=chunks,
                usage=payload.usage,
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize indexer inputs and outputs."""
        input_payload = EmbeddingPayload.model_validate(inputs.get("embedded"))
        output_payload = IndexingPayload.model_validate(outputs.get("indexed"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Embeddings",
                    value=summarize_embeddings(input_payload.chunks),
                    kind="embedding",
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={"count": len(output_payload.chunks)},
                )
            ],
        )


class IngestionOutputConfig(BaseModel):
    """Configuration for ingestion output nodes."""


class IngestionOutputNode(PipelineNodeBase):
    """Terminal node for ingestion pipelines."""

    type = "ingestion.output"
    label = "Ingestion Output"
    category = "ingestion"
    description = "Emit the indexed chunks for persistence."
    example = (
        "IndexingPayload(chunks=2) -> "
        "Result(IndexingPayload(chunks=2))."
    )
    input_ports = [NodePort(key="indexed", label="Indexed", data_type="indexed_batch")]
    output_ports = [NodePort(key="result", label="Result", data_type="indexed_batch")]
    config_model = IngestionOutputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Pass through indexed payloads."""
        payload = IndexingPayload.model_validate(inputs.get("indexed"))
        return {"result": payload}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize ingestion output payloads."""
        payload = IndexingPayload.model_validate(inputs.get("indexed"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Indexed chunks",
                    value={"count": len(payload.chunks)},
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Result",
                    value={"count": len(payload.chunks)},
                )
            ],
        )
