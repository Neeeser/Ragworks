"""What a pipeline's parse nodes claim, and the file-modality finding.

The claim derivation answers "can this pipeline read this file?" — upload
eligibility records a type nothing claims as unsupported — while the modality
finding catches an upload that reaches no parse node at all.
"""

from __future__ import annotations

from uuid import uuid4

from app.pipelines.content_coverage import claimed_content_types
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


def _validator() -> PipelineValidator:
    return PipelineValidator(default_registry())


def _claim(definition: PipelineDefinition):
    return claimed_content_types(definition, default_registry())


def test_a_text_pipeline_claims_text_types_and_not_images() -> None:
    """Upload eligibility reads this: an image here is recorded unsupported."""
    claim = _claim(_text_pipeline())

    assert "text/plain" in claim.types
    assert "image/png" not in claim.types
    assert claim.any_type is False


def test_the_plain_text_policy_claims_every_type_but_images() -> None:
    """Configured to decode unknown formats, the text parser answers for all.

    Except an image: decoding those bytes yields mojibake, not content, so a
    text-only pipeline still records an uploaded image as unsupported.
    """
    claim = _claim(_text_pipeline(unknown_format="plain_text"))

    assert claim.any_type is True
    assert claim.reads("application/x-yaml") is True
    assert claim.reads("image/png") is False


def test_an_image_node_beside_the_plain_text_policy_reads_images() -> None:
    """The catch-all excludes images; a node that genuinely reads them claims them."""
    definition = _text_pipeline(unknown_format="plain_text")
    definition.nodes.append(_node("media", "parse.media_file", "Media File"))
    definition.edges.append(_edge("e6", "in", "media", "items", "source"))
    definition.edges.append(_edge("e7", "media", "chunk", "items", "items"))

    assert _claim(definition).reads("image/png") is True


def test_an_image_node_added_to_the_graph_claims_the_image_types() -> None:
    definition = _text_pipeline()
    definition.nodes.append(_node("media", "parse.media_file", "Media File"))
    definition.edges.append(_edge("e6", "in", "media", "items", "source"))
    definition.edges.append(_edge("e7", "media", "chunk", "items", "items"))

    assert "image/png" in _claim(definition).types


def test_a_parse_node_nothing_is_wired_into_claims_nothing() -> None:
    """It never sees a file, so its formats are not this pipeline\'s."""
    definition = _text_pipeline()
    definition.nodes.append(_node("media", "parse.media_file", "Media File"))

    assert "image/png" not in _claim(definition).types


def test_a_pipeline_with_no_parse_node_reports_the_upload_as_unhandled() -> None:
    """Without a parse node the upload reaches nothing that reads it."""
    result = _validator().validate(_text_pipeline(parse=False))

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

    result = _validator().validate(definition)

    lost = [issue for issue in result.issues if issue.code == "modality.lost_modality"]
    assert len(lost) == 1
    assert "Ingestion Input" in lost[0].message
    assert "00cf19ef" not in lost[0].message


def test_the_node_catalog_publishes_what_each_parse_node_handles() -> None:
    """The editor answers format questions from the catalog, not a guess."""
    registry = default_registry()
    handled = {
        node_type: spec.handled_content_types
        for node_type in ("parse.text", "parse.media_file", "chunker.token")
        if (spec := registry.get_spec(node_type)) is not None
    }

    assert "application/pdf" in (handled["parse.text"] or [])
    assert "image/png" in (handled["parse.media_file"] or [])
    assert handled["chunker.token"] is None
