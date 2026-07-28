"""Chunk windows checked against the embedding models a chunker feeds."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.embedding_limits import embedding_limit_issues
from app.pipelines.node import PipelineNodeBase
from app.pipelines.ports import NodePort
from app.pipelines.registry import NodeRegistry, build_default_registry
from app.pipelines.tracing import NodeTraceSummary

SMALL = uuid4()
LARGE = uuid4()


def _limit(connection_id: UUID, _model: str) -> int | None:
    """Publish 512 tokens for one connection and 8192 for the other."""
    return 512 if connection_id == SMALL else 8192


class _ChunkPassThrough(PipelineNodeBase[Any]):
    """A node that forwards chunk batches unchanged.

    No shipped node forwards chunks, so without one the indirect path is
    unreachable and its behavior untestable. Registering it here exercises the
    transitive walk with a real graph rather than asserting on internals.
    """

    type = "test.chunk_passthrough"
    label = "Pass Through"
    category = "utility"
    description = "Forwards chunks unchanged."
    input_ports = (NodePort(key="chunks", label="Chunks", data_type="chunk_batch"),)
    output_ports = (NodePort(key="chunks", label="Chunks", data_type="chunk_batch"),)

    def run(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        """Return the inputs untouched."""
        return inputs

    def summarize(self, *_args: Any, **_kwargs: Any) -> NodeTraceSummary:
        """Return an empty trace summary."""
        return NodeTraceSummary()


def _registry_with_passthrough() -> NodeRegistry:
    base = build_default_registry()
    builtin = [base.get_node_class(node_type) for node_type in base.node_types()]
    return NodeRegistry([node for node in builtin if node is not None] + [_ChunkPassThrough])


def _chunker(size: int, overlap: int) -> PipelineNodeDefinition:
    return PipelineNodeDefinition(
        id="chunk",
        type="chunker.token",
        name="C",
        config={"chunk_size": size, "chunk_overlap": overlap},
    )


def _embedder(node_id: str, connection_id: UUID, model: str) -> PipelineNodeDefinition:
    return PipelineNodeDefinition(
        id=node_id,
        type="embedder.text",
        name=node_id,
        config={"connection_id": str(connection_id), "model_name": model},
    )


def _edge(source: str, target: str) -> PipelineEdgeDefinition:
    return PipelineEdgeDefinition(
        id=f"{source}-{target}",
        source=source,
        target=target,
        source_port="chunks",
        target_port="chunks",
    )


def test_a_direct_feed_over_the_limit_is_an_error() -> None:
    definition = PipelineDefinition(
        nodes=[_chunker(400, 200), _embedder("embed", SMALL, "small-model")],
        edges=[_edge("chunk", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.severity for issue in issues] == ["error"]
    assert issues[0].node_id == "chunk"
    assert issues[0].field == "chunk_size"
    assert issues[0].configured_value == 600


def test_fan_out_reports_one_issue_bound_by_the_smallest_limit() -> None:
    """Several issues on one field would hide each other in the editor.

    The editor renders a single issue per field, so emitting one per embedder
    could leave the *least* restrictive one showing.
    """
    definition = PipelineDefinition(
        nodes=[
            _chunker(400, 200),
            _embedder("big", LARGE, "large-model"),
            _embedder("small", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "big"), _edge("chunk", "small")],
    )

    issues = [
        issue
        for issue in embedding_limit_issues(definition, build_default_registry(), _limit)
        if issue.code == "embedding_input_limit_exceeded"
    ]

    assert len(issues) == 1
    assert issues[0].allowed_max == 496
    assert "small-model" in issues[0].message


def test_a_window_fitting_every_reachable_embedder_is_silent() -> None:
    definition = PipelineDefinition(
        nodes=[_chunker(300, 100), _embedder("embed", SMALL, "small-model")],
        edges=[_edge("chunk", "embed")],
    )

    assert embedding_limit_issues(definition, build_default_registry(), _limit) == []


def test_a_chunker_feeding_no_embedder_is_silent() -> None:
    """The hybrid default's BM25 branch has no token limit to exceed."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(4000, 2000),
            PipelineNodeDefinition(id="bm25", type="indexer.bm25", name="B", config={}),
        ],
        edges=[_edge("chunk", "bm25")],
    )

    assert embedding_limit_issues(definition, build_default_registry(), _limit) == []


def test_an_embedder_without_a_model_adds_no_second_finding() -> None:
    """The embedder already reports its own missing-model error."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(4000, 2000),
            PipelineNodeDefinition(id="embed", type="embedder.text", name="E", config={}),
        ],
        edges=[_edge("chunk", "embed")],
    )

    assert embedding_limit_issues(definition, build_default_registry(), _limit) == []


def test_an_indirect_path_is_found_but_only_warns() -> None:
    """A node between them may resize the chunks, so this advises, not blocks."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(400, 200),
            PipelineNodeDefinition(
                id="pass", type="test.chunk_passthrough", name="P", config={}
            ),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "pass"), _edge("pass", "embed")],
    )

    issues = embedding_limit_issues(definition, _registry_with_passthrough(), _limit)

    assert [issue.severity for issue in issues] == ["warning"]
    assert "through another node" in issues[0].message
    assert issues[0].node_id == "chunk"


def test_a_direct_feed_wins_over_a_longer_path_to_the_same_embedder() -> None:
    """Shortest path decides, so an extra indirect wire cannot soften an error."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(400, 200),
            PipelineNodeDefinition(
                id="pass", type="test.chunk_passthrough", name="P", config={}
            ),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "embed"), _edge("chunk", "pass"), _edge("pass", "embed")],
    )

    issues = embedding_limit_issues(definition, _registry_with_passthrough(), _limit)

    assert [issue.severity for issue in issues] == ["error"]


def test_an_unpublished_limit_warns_once_for_the_embedder() -> None:
    definition = PipelineDefinition(
        nodes=[_chunker(400, 200), _embedder("embed", uuid4(), "mystery")],
        edges=[_edge("chunk", "embed")],
    )

    issues = embedding_limit_issues(
        definition, build_default_registry(), lambda _connection, _model: None
    )

    assert [issue.code for issue in issues] == ["embedding_input_limit_unknown"]
