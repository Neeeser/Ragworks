"""The multimodal ingestion graph the `multimodal` scenario binds.

Three branches off one router, which is what a modular graph looks like
once files stop being uniformly text: a PDF's prose is parsed and chunked,
a PDF's figures are extracted and described, and an uploaded image is
described on its own. Each branch embeds and indexes what it produced —
descriptions reach the lexical index too, or a described image loses every
hybrid ranking to documents that are in both lists — and the terminal
merges them.

Built here rather than in `app/pipelines/defaults.py` because it is a
scenario's state, not a shipped default — the shipped defaults stay text.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

if TYPE_CHECKING:
    from app.pipelines.definition import PipelineDefinition


def build_multimodal_ingestion_pipeline(
    *,
    embedding_connection_id: UUID,
    embedding_model: str,
    chat_connection_id: UUID,
    vision_model: str,
    index_name: str,
    dimension: int,
) -> PipelineDefinition:
    """Return an ingestion graph that handles prose, PDF figures, and images."""
    from app.pipelines.definition import (
        PipelineDefinition,
        PipelineEdgeDefinition,
        PipelineNodeDefinition,
    )
    from app.pipelines.llm.presets import DESCRIBE_PRESETS
    from app.schemas.enums import IndexBackend

    describe_presets = {preset.id: preset for preset in DESCRIBE_PRESETS}
    backend = IndexBackend.PGVECTOR.value

    def describe(node_id: str, name: str, preset: str) -> PipelineNodeDefinition:
        """One vision shell seeded from a shipped preset, as dropping it would."""
        config: dict[str, Any] = dict(describe_presets[preset].config)
        config["connection_id"] = str(chat_connection_id)
        config["model_name"] = vision_model
        return PipelineNodeDefinition(id=node_id, type="llm.describe", name=name, config=config)

    def embedder(node_id: str, name: str) -> PipelineNodeDefinition:
        return PipelineNodeDefinition(
            id=node_id,
            type="embedder.text",
            name=name,
            config={
                "connection_id": str(embedding_connection_id),
                "model_name": embedding_model,
            },
        )

    def bm25_indexer(node_id: str, name: str) -> PipelineNodeDefinition:
        return PipelineNodeDefinition(
            id=node_id,
            type="indexer.bm25",
            name=name,
            config={"backend": backend, "index_name": f"{index_name}-bm25"},
        )

    def indexer(node_id: str, name: str) -> PipelineNodeDefinition:
        return PipelineNodeDefinition(
            id=node_id,
            type="indexer.vector",
            name=name,
            config={"backend": backend, "index_name": index_name, "dimension": dimension},
        )

    def edge(
        edge_id: str, source: str, target: str, source_port: str, target_port: str
    ) -> PipelineEdgeDefinition:
        return PipelineEdgeDefinition(
            id=edge_id,
            source=source,
            target=target,
            source_port=source_port,
            target_port=target_port,
        )

    nodes = [
        PipelineNodeDefinition(id="ingest-input", type="ingestion.input", name="Ingestion Input"),
        PipelineNodeDefinition(id="route", type="router.file_type", name="File Type Router"),
        # Prose branch: the text path, unchanged from the shipped default.
        PipelineNodeDefinition(id="parse", type="parser.document", name="Document Parser"),
        PipelineNodeDefinition(
            id="chunk",
            type="chunker.token",
            name="Token Chunker",
            config={"chunk_size": 400, "chunk_overlap": 60},
        ),
        embedder("embed-text", "Embedder (text)"),
        indexer("index-text", "Indexer (text)"),
        bm25_indexer("index-text-bm25", "BM25 Indexer (text)"),
        # Figure branch: images embedded inside a PDF, described then indexed.
        PipelineNodeDefinition(id="pdf-images", type="pdf.images", name="PDF Images"),
        describe("describe-figures", "Describe figures", "describe-image"),
        embedder("embed-figures", "Embedder (figures)"),
        indexer("index-figures", "Indexer (figures)"),
        bm25_indexer("index-figures-bm25", "BM25 Indexer (figures)"),
        # Image branch: a file that is itself an image.
        PipelineNodeDefinition(id="image-in", type="image.source", name="Image Source"),
        describe("describe-images", "Describe images", "describe-image"),
        embedder("embed-images", "Embedder (images)"),
        indexer("index-images", "Indexer (images)"),
        bm25_indexer("index-images-bm25", "BM25 Indexer (images)"),
        PipelineNodeDefinition(id="out", type="ingestion.output", name="Ingestion Output"),
    ]
    edges = [
        edge("e-input-route", "ingest-input", "route", "source", "source"),
        edge("e-route-parse", "route", "parse", "pdf", "source"),
        edge("e-parse-chunk", "parse", "chunk", "document", "document"),
        edge("e-chunk-embed", "chunk", "embed-text", "items", "items"),
        edge("e-embed-index", "embed-text", "index-text", "items", "items"),
        edge("e-chunk-bm25", "chunk", "index-text-bm25", "items", "items"),
        edge("e-index-out", "index-text", "out", "items", "items"),
        edge("e-bm25-out", "index-text-bm25", "out", "items", "items"),
        edge("e-route-figures", "route", "pdf-images", "pdf", "source"),
        edge("e-figures-describe", "pdf-images", "describe-figures", "items", "items"),
        edge("e-describe-embed", "describe-figures", "embed-figures", "items", "items"),
        edge("e-embed-figures-index", "embed-figures", "index-figures", "items", "items"),
        edge("e-figures-out", "index-figures", "out", "items", "items"),
        edge("e-describe-bm25", "describe-figures", "index-figures-bm25", "items", "items"),
        edge("e-figures-bm25-out", "index-figures-bm25", "out", "items", "items"),
        edge("e-route-image", "route", "image-in", "image", "source"),
        edge("e-image-describe", "image-in", "describe-images", "items", "items"),
        edge("e-describe-images-embed", "describe-images", "embed-images", "items", "items"),
        edge("e-embed-images-index", "embed-images", "index-images", "items", "items"),
        edge("e-images-out", "index-images", "out", "items", "items"),
        edge("e-describe-images-bm25", "describe-images", "index-images-bm25", "items", "items"),
        edge("e-images-bm25-out", "index-images-bm25", "out", "items", "items"),
    ]
    return PipelineDefinition(nodes=nodes, edges=edges)
