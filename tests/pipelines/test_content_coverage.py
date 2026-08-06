"""Content-type coverage and the file-modality finding.

Between them these answer "will this pipeline do anything with what my
deployment auto-ingests?" — the coverage warning names the types nothing
claims, and the modality finding catches an upload that reaches no parse
node at all.
"""

from __future__ import annotations

from uuid import uuid4

from app.pipelines.content_coverage import COVERAGE_CODE
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidator

EMBED_CONNECTION = uuid4()


def _node(node_id: str, node_type: str, name: str, **config: object) -> PipelineNodeDefinition:
    return PipelineNodeDefinition(id=node_id, type=node_type, name=name, config=config)


def _edge(
    edge_id: str, source: str, target: str, source_port: str, target_port: str
) -> PipelineEdgeDefinition:
    return PipelineEdgeDefinition(
        id=edge_id, source=source, target=target, source_port=source_port, target_port=target_port
    )


def _text_pipeline(*, parse: bool = True, **parse_config: object) -> PipelineDefinition:
    """input -> [parse.text] -> chunker -> embed -> dense index -> out."""
    nodes = [
        _node("in", "ingestion.input", "Ingestion Input"),
        _node("chunk", "chunker.token", "Token Chunker", chunk_size=64, chunk_overlap=0),
        _node(
            "embed",
            "embedder.text",
            "Embedder",
            connection_id=str(EMBED_CONNECTION),
            model_name="embed-model",
        ),
        _node("index", "indexer.vector", "Indexer", backend="pgvector", index_name="docs"),
        _node("out", "ingestion.output", "Ingestion Output"),
    ]
    edges = [
        _edge("e3", "chunk", "embed", "items", "items"),
        _edge("e4", "embed", "index", "items", "items"),
        _edge("e5", "index", "out", "items", "items"),
    ]
    if parse:
        nodes.insert(1, _node("parse", "parse.text", "Extract Text", **parse_config))
        edges = [
            _edge("e1", "in", "parse", "items", "source"),
            _edge("e2", "parse", "chunk", "items", "items"),
            *edges,
        ]
    else:
        edges.insert(0, _edge("e1", "in", "chunk", "items", "items"))
    return PipelineDefinition(nodes=nodes, edges=edges)


def _validator(*types: str) -> PipelineValidator:
    return PipelineValidator(
        default_registry(), auto_ingest_types=lambda: frozenset(types)
    )


def test_an_auto_ingested_type_nothing_parses_is_named() -> None:
    result = _validator("text/plain", "application/pdf", "image/png").validate(_text_pipeline())

    coverage = [issue for issue in result.issues if issue.code == COVERAGE_CODE]
    assert len(coverage) == 1
    assert "image/png" in coverage[0].message
    assert "text/plain" not in coverage[0].message
    # Advisory: a pipeline built for a subset of the deployment still saves.
    assert coverage[0].severity == "warning"
    assert result.valid is True


def test_a_pipeline_covering_every_auto_ingested_type_says_nothing() -> None:
    result = _validator("text/plain", "application/pdf").validate(_text_pipeline())

    assert [issue for issue in result.issues if issue.code == COVERAGE_CODE] == []


def test_the_plain_text_policy_claims_every_type() -> None:
    """Decoding unknown formats as text is a claim on all of them."""
    result = _validator("text/plain", "image/png").validate(
        _text_pipeline(unknown_format="plain_text")
    )

    assert [issue for issue in result.issues if issue.code == COVERAGE_CODE] == []


def test_an_image_node_added_to_the_graph_covers_the_image_types() -> None:
    definition = _text_pipeline()
    definition.nodes.append(_node("media", "parse.media_file", "Media File"))
    definition.edges.append(_edge("e6", "in", "media", "items", "source"))
    definition.edges.append(_edge("e7", "media", "chunk", "items", "items"))

    result = _validator("text/plain", "image/png").validate(definition)

    assert [issue for issue in result.issues if issue.code == COVERAGE_CODE] == []


def test_a_retrieval_pipeline_is_never_asked_about_uploads() -> None:
    """Nothing in a retrieval graph emits a file, so coverage has no meaning."""
    definition = PipelineDefinition(
        nodes=[
            _node("q", "retrieval.input", "Retrieval Input"),
            _node(
                "embed",
                "embedder.text",
                "Embedder",
                connection_id=str(EMBED_CONNECTION),
                model_name="embed-model",
            ),
            _node("r", "retriever.vector", "Retriever", backend="pgvector", index_name="docs"),
            _node("out", "retrieval.output", "Retrieval Output"),
        ],
        edges=[
            _edge("e1", "q", "embed", "items", "items"),
            _edge("e2", "embed", "r", "items", "items"),
            _edge("e3", "r", "out", "items", "items"),
        ],
    )

    result = _validator("text/plain", "image/png").validate(definition)

    assert [issue for issue in result.issues if issue.code == COVERAGE_CODE] == []


def test_a_pipeline_with_no_parse_node_reports_the_upload_as_unhandled() -> None:
    """Without a parse node the upload reaches nothing that reads it."""
    result = _validator("text/plain").validate(_text_pipeline(parse=False))

    lost = [
        issue
        for issue in result.issues
        if issue.code == "modality.lost_modality" and issue.node_id == "in"
    ]
    assert len(lost) == 1
    assert "File items" in lost[0].message


def test_findings_name_nodes_by_their_label() -> None:
    """A finding interpolating a node UUID is unreadable beside the canvas."""
    definition = _text_pipeline(parse=False)
    definition.nodes[0].id = "00cf19ef-2a1c-4c3f-9a0e-2a4a2c8d1111"
    definition.edges[0].source = definition.nodes[0].id

    result = _validator("text/plain").validate(definition)

    lost = [issue for issue in result.issues if issue.code == "modality.lost_modality"]
    assert len(lost) == 1
    assert "Ingestion Input" in lost[0].message
    assert "00cf19ef" not in lost[0].message


def test_the_node_catalog_publishes_what_each_parse_node_handles() -> None:
    """The editor answers coverage questions from the catalog, not a guess."""
    registry = default_registry()
    handled = {
        node_type: spec.handled_content_types
        for node_type in ("parse.text", "parse.media_file", "chunker.token")
        if (spec := registry.get_spec(node_type)) is not None
    }

    assert "application/pdf" in (handled["parse.text"] or [])
    assert "image/png" in (handled["parse.media_file"] or [])
    assert handled["chunker.token"] is None
