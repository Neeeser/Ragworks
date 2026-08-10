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
from app.pipelines.ports import NodePort, PortKind
from app.pipelines.registry import NodeRegistry, build_default_registry
from app.pipelines.tracing import NodeTraceSummary

SMALL = uuid4()
LARGE = uuid4()


def _limit(connection_id: UUID, _model: str) -> int | None:
    """Publish 512 tokens for one connection and 8192 for the other."""
    return 512 if connection_id == SMALL else 8192


class _ChunkPassThrough(PipelineNodeBase[Any]):
    """A node that forwards item streams unchanged (a preserving output).

    Only the result-limit node forwards items today, so registering a bare
    forwarder here exercises the transitive walk with a real graph rather
    than asserting on internals.
    """

    type = "test.chunk_passthrough"
    label = "Pass Through"
    category = "utility"
    description = "Forwards items unchanged."
    input_ports = (NodePort(key="items", label="Items", data_type=PortKind.ITEMS),)
    output_ports = (
        NodePort(key="items", label="Items", data_type=PortKind.ITEMS, preserves=True),
    )

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


def _text_writer(
    node_id: str,
    *,
    mode: str = "prepend",
    max_output_tokens: int | None = None,
) -> PipelineNodeDefinition:
    """An LLM transform whose single output field writes into the item text."""
    config: dict[str, Any] = {
        "prompt": "{{text}}",
        "output_fields": [
            {
                "name": "context",
                "type": "string",
                "target": {"kind": "text", "mode": mode, "separator": "\n\n"},
            }
        ],
    }
    if max_output_tokens is not None:
        config["max_output_tokens"] = max_output_tokens
    return PipelineNodeDefinition(id=node_id, type="llm.transform", name=node_id, config=config)


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
        source_port="items",
        target_port="items",
    )


def test_a_direct_feed_over_the_limit_warns_without_blocking_the_save() -> None:
    """The guard splits oversized chunks, so this advises rather than blocks."""
    definition = PipelineDefinition(
        nodes=[_chunker(400, 200), _embedder("embed", SMALL, "small-model")],
        edges=[_edge("chunk", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.severity for issue in issues] == ["warning"]
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
    """Shortest path decides which explanation the message carries."""
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

    assert "through another node" not in issues[0].message


def test_an_unpublished_limit_warns_once_for_the_embedder() -> None:
    definition = PipelineDefinition(
        nodes=[_chunker(400, 200), _embedder("embed", uuid4(), "mystery")],
        edges=[_edge("chunk", "embed")],
    )

    issues = embedding_limit_issues(
        definition, build_default_registry(), lambda _connection, _model: None
    )

    assert [issue.code for issue in issues] == ["embedding_input_limit_unknown"]


def test_text_added_downstream_pushes_a_fitting_window_over_the_limit() -> None:
    """The window fits the model until a node on the path writes into the text.

    413 + 83 lands exactly on the 496-token effective limit, so the chunker
    alone is silent; a contextual-retrieval node between it and the embedder
    prepends up to its own output budget to every item, and what the model
    receives no longer fits.
    """
    definition = PipelineDefinition(
        nodes=[
            _chunker(413, 83),
            _text_writer("context", max_output_tokens=150),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "context"), _edge("context", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.code for issue in issues] == ["embedding_input_limit_exceeded"]
    assert issues[0].severity == "warning"
    assert issues[0].node_id == "chunk"
    assert issues[0].field == "chunk_size"
    # 413 + 83 + (150 budget + 1 separator token) — the separator joins the
    # written text onto the chunk, so it counts too.
    assert issues[0].configured_value == 647
    assert "'context'" in issues[0].message


def test_the_chunker_alone_is_silent_at_the_limit() -> None:
    """The same window with nothing added is exactly what the model takes."""
    definition = PipelineDefinition(
        nodes=[_chunker(413, 83), _embedder("embed", SMALL, "small-model")],
        edges=[_edge("chunk", "embed")],
    )

    assert embedding_limit_issues(definition, build_default_registry(), _limit) == []


def test_a_text_writer_with_no_output_budget_cannot_be_verified() -> None:
    """An unbounded writer makes the window unknowable, so say so on its field."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(413, 83),
            _text_writer("context"),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "context"), _edge("context", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.code for issue in issues] == ["embedding_input_limit_unverifiable"]
    assert issues[0].severity == "warning"
    assert issues[0].node_id == "context"
    assert issues[0].field == "max_output_tokens"
    assert "small-model" in issues[0].message


def test_a_replacing_writer_sets_the_window_to_its_own_budget() -> None:
    """A replace discards the chunk, so the chunker's size stops governing.

    413 + 83 + 400 would exceed the model; the replaced text is 400, which
    fits — counting a replace as an increment reports a window that never
    reaches the model.
    """
    definition = PipelineDefinition(
        nodes=[
            _chunker(413, 83),
            _text_writer("summary", mode="replace", max_output_tokens=400),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "summary"), _edge("summary", "embed")],
    )

    assert embedding_limit_issues(definition, build_default_registry(), _limit) == []


def test_a_replacing_writer_over_the_limit_is_reported_on_its_own_budget() -> None:
    """Nothing about the chunker fixes this: the replaced text is what overflows."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(413, 83),
            _text_writer("summary", mode="replace", max_output_tokens=4000),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "summary"), _edge("summary", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.code for issue in issues] == ["embedding_input_limit_exceeded"]
    assert issues[0].severity == "warning"
    assert issues[0].node_id == "summary"
    assert issues[0].field == "max_output_tokens"
    assert issues[0].configured_value == 4000
    assert "small-model" in issues[0].message


def test_a_replacing_writer_with_no_budget_cannot_be_verified() -> None:
    """With no budget and no tie to the chunk size, nothing about it is knowable."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(413, 83),
            _text_writer("summary", mode="replace"),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "summary"), _edge("summary", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.code for issue in issues] == ["embedding_input_limit_unverifiable"]
    assert issues[0].node_id == "summary"
    assert issues[0].field == "max_output_tokens"


def test_text_added_after_a_replace_accumulates_on_the_replaced_window() -> None:
    """The replace sets the base; a later writer still adds on top of it."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(413, 83),
            _text_writer("summary", mode="replace", max_output_tokens=400),
            _text_writer("context", max_output_tokens=150),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[
            _edge("chunk", "summary"),
            _edge("summary", "context"),
            _edge("context", "embed"),
        ],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.code for issue in issues] == ["embedding_input_limit_exceeded"]
    # 400 replaced + (150 budget + 1 separator token) — not the chunker's 496.
    assert issues[0].configured_value == 551


def test_a_metadata_only_writer_adds_nothing_to_the_window() -> None:
    """Metadata never joins the embedded text, so it cannot overflow the limit."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(413, 83),
            PipelineNodeDefinition(
                id="meta",
                type="llm.transform",
                name="meta",
                config={
                    "prompt": "{{text}}",
                    "output_fields": [
                        {"name": "topic", "type": "string", "target": {"kind": "metadata", "key": "topic"}}
                    ],
                },
            ),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "meta"), _edge("meta", "embed")],
    )

    assert embedding_limit_issues(definition, build_default_registry(), _limit) == []


class _ItemProducer(PipelineNodeBase[Any]):
    """A node that emits *new* items (a non-preserving output), like a retriever."""

    type = "test.item_producer"
    label = "Producer"
    category = "utility"
    description = "Emits new items."
    input_ports = (NodePort(key="items", label="Items", data_type=PortKind.ITEMS),)
    output_ports = (NodePort(key="items", label="Items", data_type=PortKind.ITEMS),)

    def run(self, inputs: dict[str, Any], context: Any) -> dict[str, Any]:
        """Return the inputs untouched (shape only — tests never run it)."""
        return inputs

    def summarize(self, *_args: Any, **_kwargs: Any) -> NodeTraceSummary:
        """Return an empty trace summary."""
        return NodeTraceSummary()


def test_a_non_preserving_node_ends_the_walk() -> None:
    """A node that emits new items (a retriever) breaks the chunker's reach:
    its output is no longer the chunker's chunks, so the window comparison
    would be judging items the chunker never sized."""
    base = build_default_registry()
    builtin = [base.get_node_class(node_type) for node_type in base.node_types()]
    registry = NodeRegistry([node for node in builtin if node is not None] + [_ItemProducer])
    definition = PipelineDefinition(
        nodes=[
            _chunker(4000, 2000),
            PipelineNodeDefinition(id="produce", type="test.item_producer", name="P", config={}),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "produce"), _edge("produce", "embed")],
    )

    assert embedding_limit_issues(definition, registry, _limit) == []


def _describe(
    node_id: str,
    *,
    max_output_tokens: int | None = None,
) -> PipelineNodeDefinition:
    """A vision node: it accepts images alone and appends onto what it describes."""
    config: dict[str, Any] = {
        "prompt": "Describe this image.",
        "output_fields": [
            {
                "name": "description",
                "type": "string",
                "target": {"kind": "text", "mode": "append", "separator": "\n\n"},
            }
        ],
    }
    if max_output_tokens is not None:
        config["max_output_tokens"] = max_output_tokens
    return PipelineNodeDefinition(id=node_id, type="llm.describe", name=node_id, config=config)


def test_a_vision_writer_does_not_count_against_the_chunkers_window() -> None:
    """It accepts images alone, so the chunks it forwards arrive unchanged.

    Charging its budget to the chunker refuses a `chunk_size` that fits, on
    the one field that cannot fix it.
    """
    definition = PipelineDefinition(
        nodes=[
            _chunker(400, 60),
            _describe("describe", max_output_tokens=300),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "describe"), _edge("describe", "embed")],
    )

    assert embedding_limit_issues(definition, build_default_registry(), _limit) == []


def test_a_vision_writer_over_the_limit_is_reported_on_its_own_budget() -> None:
    """The items it writes onto were never chunked, so its budget is the bound."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(200, 0),
            _describe("describe", max_output_tokens=900),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "describe"), _edge("describe", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.code for issue in issues] == ["embedding_input_limit_exceeded"]
    assert issues[0].node_id == "describe"
    assert issues[0].field == "max_output_tokens"
    # 900 budget + 1 token for the separator it joins on with.
    assert issues[0].configured_value == 901
    assert "small-model" in issues[0].message


def test_a_vision_writer_with_no_budget_cannot_be_verified() -> None:
    """No budget, and no chunker window to fall back on: nothing is knowable."""
    definition = PipelineDefinition(
        nodes=[
            _chunker(200, 0),
            _describe("describe"),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "describe"), _edge("describe", "embed")],
    )

    issues = embedding_limit_issues(definition, build_default_registry(), _limit)

    assert [issue.code for issue in issues] == ["embedding_input_limit_unverifiable"]
    assert issues[0].node_id == "describe"
    assert issues[0].field == "max_output_tokens"


def test_a_model_that_reads_text_makes_its_writer_count_against_the_window() -> None:
    """`accepts` is read resolved, so a widened port is charged to the chunker.

    A node whose contract follows its model writes onto every chunk once the
    model reads text; exempting it on its class declaration alone would drop
    a term the run actually spends.
    """
    definition = PipelineDefinition(
        nodes=[
            _chunker(400, 60),
            _describe("describe", max_output_tokens=300),
            _embedder("embed", SMALL, "small-model"),
        ],
        edges=[_edge("chunk", "describe"), _edge("describe", "embed")],
    )

    issues = embedding_limit_issues(
        definition,
        build_default_registry(),
        _limit,
        {("describe", "items"): frozenset({"image", "text"})},
    )

    assert [issue.code for issue in issues] == ["embedding_input_limit_exceeded"]
    assert issues[0].node_id == "chunk"
    assert issues[0].field == "chunk_size"
    # 400 + 60 + (300 budget + 1 separator token).
    assert issues[0].configured_value == 761
