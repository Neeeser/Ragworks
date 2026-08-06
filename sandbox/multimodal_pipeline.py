"""The multimodal ingestion graphs the `multimodal` scenarios bind.

Both graphs have the same intake shape: the uploaded file fans out to the
parse nodes in parallel — text extraction, media embedded in the file, and
the file itself when it already is an image — and `merge.items` brings the
branches back together so one chunk/describe/embed/index chain serves all
of them. Each parse node consumes the file items its registry answers for
and passes everything else through, so which formats a branch covers is
registry data rather than graph shape.

Built here rather than in `app/pipelines/defaults.py` because it is a
scenario's state, not a shipped default — the shipped defaults stay text.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

if TYPE_CHECKING:
    from app.pipelines.definition import (
        PipelineDefinition,
        PipelineEdgeDefinition,
        PipelineNodeDefinition,
    )


def _intake_nodes() -> list[PipelineNodeDefinition]:
    """The input, the three parse branches, and the merge that rejoins them."""
    from app.pipelines.definition import PipelineNodeDefinition

    return [
        PipelineNodeDefinition(id="ingest-input", type="ingestion.input", name="Ingestion Input"),
        PipelineNodeDefinition(id="parse-text", type="parse.text", name="Extract Text"),
        PipelineNodeDefinition(
            id="parse-embedded", type="parse.embedded_media", name="Extract Media"
        ),
        PipelineNodeDefinition(id="parse-media", type="parse.media_file", name="Media File"),
        PipelineNodeDefinition(id="merge", type="merge.items", name="Merge Items"),
    ]


def _intake_edges() -> list[PipelineEdgeDefinition]:
    """Fan the file out to every parse node and merge what they produce."""
    from app.pipelines.definition import PipelineEdgeDefinition

    parsers = ("parse-text", "parse-embedded", "parse-media")
    fan_out = [
        PipelineEdgeDefinition(
            id=f"e-input-{parser}",
            source="ingest-input",
            target=parser,
            source_port="items",
            target_port="source",
        )
        for parser in parsers
    ]
    fan_in = [
        PipelineEdgeDefinition(
            id=f"e-{parser}-merge",
            source=parser,
            target="merge",
            source_port="items",
            target_port="items",
        )
        for parser in parsers
    ]
    return fan_out + fan_in


def build_multimodal_ingestion_pipeline(
    *,
    embedding_connection_id: UUID,
    embedding_model: str,
    chat_connection_id: UUID,
    vision_model: str,
    index_name: str,
    dimension: int,
) -> PipelineDefinition:
    """Return an ingestion graph that handles prose, embedded figures, and images.

    One chain after the merge: the chunker splits the extracted text and
    passes images through, the vision shell describes the images and passes
    the chunks through, and everything downstream embeds and indexes once.
    Descriptions reach the lexical index too, or a described image loses
    every hybrid ranking to documents that are in both lists.
    """
    from app.pipelines.definition import (
        PipelineDefinition,
        PipelineEdgeDefinition,
        PipelineNodeDefinition,
    )
    from app.pipelines.llm.presets import DESCRIBE_PRESETS
    from app.schemas.enums import IndexBackend

    describe_presets = {preset.id: preset for preset in DESCRIBE_PRESETS}
    backend = IndexBackend.PGVECTOR.value
    config: dict[str, Any] = dict(describe_presets["describe-image"].config)
    config["connection_id"] = str(chat_connection_id)
    config["model_name"] = vision_model

    nodes = [
        *_intake_nodes(),
        PipelineNodeDefinition(
            id="chunk",
            type="chunker.token",
            name="Token Chunker",
            config={"chunk_size": 400, "chunk_overlap": 60},
        ),
        PipelineNodeDefinition(
            id="describe", type="llm.describe", name="Describe images", config=config
        ),
        PipelineNodeDefinition(
            id="embed",
            type="embedder.text",
            name="Embedder",
            config={
                "connection_id": str(embedding_connection_id),
                "model_name": embedding_model,
            },
        ),
        PipelineNodeDefinition(
            id="index",
            type="indexer.vector",
            name="Semantic Indexer",
            config={"backend": backend, "index_name": index_name, "dimension": dimension},
        ),
        PipelineNodeDefinition(
            id="index-bm25",
            type="indexer.bm25",
            name="BM25 Indexer",
            config={"backend": backend, "index_name": f"{index_name}-bm25"},
        ),
        PipelineNodeDefinition(id="out", type="ingestion.output", name="Ingestion Output"),
    ]
    edges = [
        *_intake_edges(),
        PipelineEdgeDefinition(
            id="e-merge-chunk",
            source="merge",
            target="chunk",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-chunk-describe",
            source="chunk",
            target="describe",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-describe-embed",
            source="describe",
            target="embed",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-embed-index",
            source="embed",
            target="index",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-describe-bm25",
            source="describe",
            target="index-bm25",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-index-out",
            source="index",
            target="out",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-bm25-out",
            source="index-bm25",
            target="out",
            source_port="items",
            target_port="items",
        ),
    ]
    return PipelineDefinition(nodes=nodes, edges=edges)


def build_shared_space_ingestion_pipeline(
    *,
    embedding_connection_id: UUID,
    embedding_model: str,
    index_name: str,
    dimension: int,
) -> PipelineDefinition:
    """Return an ingestion graph that embeds text and images into one space.

    No describe step anywhere: an image-capable embedding model puts an
    image and a sentence in the same vector space, so a text query reaches
    an image directly rather than through prose written about it. That is
    the shape a multimodal embedding model exists for, and it needs one
    model and one index for the whole corpus — two models would mean two
    widths, and a match in one space says nothing about the other. The BM25
    branch takes the same merged stream and indexes the text items in it;
    an image carries no text, so the lexical indexer excludes it.
    """
    from app.pipelines.definition import (
        PipelineDefinition,
        PipelineEdgeDefinition,
        PipelineNodeDefinition,
    )
    from app.schemas.enums import IndexBackend

    backend = IndexBackend.PGVECTOR.value

    nodes = [
        *_intake_nodes(),
        PipelineNodeDefinition(
            id="chunk",
            type="chunker.token",
            name="Token Chunker",
            config={"chunk_size": 400, "chunk_overlap": 60},
        ),
        PipelineNodeDefinition(
            id="embed",
            type="embedder.text",
            name="Embedder",
            config={
                "connection_id": str(embedding_connection_id),
                "model_name": embedding_model,
            },
        ),
        PipelineNodeDefinition(
            id="index",
            type="indexer.vector",
            name="Semantic Indexer",
            config={"backend": backend, "index_name": index_name, "dimension": dimension},
        ),
        PipelineNodeDefinition(
            id="index-bm25",
            type="indexer.bm25",
            name="BM25 Indexer",
            config={"backend": backend, "index_name": f"{index_name}-bm25"},
        ),
        PipelineNodeDefinition(id="out", type="ingestion.output", name="Ingestion Output"),
    ]
    edges = [
        *_intake_edges(),
        PipelineEdgeDefinition(
            id="e-merge-chunk",
            source="merge",
            target="chunk",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-chunk-embed",
            source="chunk",
            target="embed",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-chunk-bm25",
            source="chunk",
            target="index-bm25",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-embed-index",
            source="embed",
            target="index",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-index-out",
            source="index",
            target="out",
            source_port="items",
            target_port="items",
        ),
        PipelineEdgeDefinition(
            id="e-bm25-out",
            source="index-bm25",
            target="out",
            source_port="items",
            target_port="items",
        ),
    ]
    return PipelineDefinition(nodes=nodes, edges=edges)
