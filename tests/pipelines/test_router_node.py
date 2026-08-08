"""Router node: first-match branching, the unmatched port, and dynamic ports."""

from __future__ import annotations

import pytest

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.node_ports import derived_output_ports, resolve_output_ports
from app.pipelines.nodes.routing import (
    BRANCH_PORT_PREFIX,
    UNMATCHED_PORT,
    RouterBranchError,
    RouterConfig,
    RouterNode,
)
from app.pipelines.payloads import Item, ItemBatch
from app.pipelines.registry import build_default_registry
from app.pipelines.validation import PipelineValidator
from app.retrieval.models import DocumentMetadata


def _branch_port(branch_id: str) -> str:
    return f"{BRANCH_PORT_PREFIX}:{branch_id}"


def _router(*branches: tuple[str, str, str]) -> RouterNode:
    """Build a router from `(id, name, expression)` triples."""
    return RouterNode(
        RouterConfig.model_validate(
            {
                "branches": [
                    {"id": branch_id, "name": name, "expression": expression}
                    for branch_id, name, expression in branches
                ]
            }
        )
    )


def _item(item_id: str, **fields: object) -> Item:
    return Item.model_validate({"id": item_id, **fields})


def _run(node: RouterNode, items: list[Item]) -> dict[str, object]:
    # The router reads nothing off the run context, so None never reaches a use.
    return node.run({"items": ItemBatch(items=items)}, None)  # type: ignore[arg-type]


def _routed(outputs: dict[str, object], port: str) -> list[str]:
    batch = ItemBatch.model_validate(outputs[port])
    return [item.id for item in batch.items]


def test_the_first_matching_branch_takes_the_item() -> None:
    """Branches are tried in order, so an item never reaches two of them."""
    node = _router(
        ("scored", "Scored", "item.has_score"),
        ("textual", "Textual", "item.has_text"),
    )
    outputs = _run(node, [_item("a", text="hello", score=0.9), _item("b", text="plain")])

    assert _routed(outputs, _branch_port("scored")) == ["a"]
    assert _routed(outputs, _branch_port("textual")) == ["b"]
    assert _routed(outputs, UNMATCHED_PORT) == []


def test_reordering_the_branches_reroutes_the_item() -> None:
    """First-match is genuinely positional, not a most-specific-wins rule."""
    node = _router(
        ("textual", "Textual", "item.has_text"),
        ("scored", "Scored", "item.has_score"),
    )
    outputs = _run(node, [_item("a", text="hello", score=0.9)])

    assert _routed(outputs, _branch_port("textual")) == ["a"]
    assert _routed(outputs, _branch_port("scored")) == []


def test_items_matching_nothing_leave_through_the_unmatched_port() -> None:
    """The default branch is a real port, so non-matching items stay routable."""
    node = _router(("images", "Images", "item.has_image"))
    outputs = _run(node, [_item("a", text="hello")])

    assert _routed(outputs, UNMATCHED_PORT) == ["a"]


def test_the_trace_counts_every_branch_including_the_dropped_items() -> None:
    """A drop is reported as a count, never as silence — nothing else records it."""
    node = _router(
        ("long", "Long", "item.text_length > 5"),
        ("images", "Images", "item.has_image"),
    )
    inputs = {"items": ItemBatch(items=[_item("a", text="a longer one"), _item("b", text="hi")])}
    outputs = node.run(inputs, None)  # type: ignore[arg-type]

    summary = node.summarize_io(inputs, outputs)
    branches = next(value for value in summary.outputs if value.label == "Branches").value
    unmatched = next(value for value in summary.outputs if value.label == "Unmatched").value

    assert branches == {
        "branches": [
            {"branch": "Long", "expression": "item.text_length > 5", "items": 1},
            {"branch": "Images", "expression": "item.has_image", "items": 0},
        ]
    }
    assert unmatched == {"items": 1}


def test_an_empty_branch_emits_an_empty_stream_rather_than_no_output() -> None:
    """Downstream nodes run on empty input, so the port must still be produced."""
    node = _router(("images", "Images", "item.has_image"))
    outputs = _run(node, [_item("a", text="hello")])

    assert _branch_port("images") in outputs
    assert ItemBatch.model_validate(outputs[_branch_port("images")]).items == []


def test_an_unconfigured_router_sends_everything_to_unmatched() -> None:
    """A node just dropped on the canvas routes rather than failing."""
    node = RouterNode(RouterConfig())
    outputs = _run(node, [_item("a", text="hello")])

    assert _routed(outputs, UNMATCHED_PORT) == ["a"]


def test_a_branch_with_no_expression_yet_receives_nothing() -> None:
    """A half-written branch is an editing state, not a run failure."""
    node = _router(("draft", "Draft", "   "))
    outputs = _run(node, [_item("a", text="hello")])

    assert _routed(outputs, _branch_port("draft")) == []
    assert _routed(outputs, UNMATCHED_PORT) == ["a"]


def test_metadata_routes_on_an_item_that_carries_the_key() -> None:
    """Metadata members read the item's own data, stringified."""
    node = _router(("finance", "Finance", 'item.metadata.section == "finance"'))
    outputs = _run(
        node,
        [
            _item("a", text="x", metadata=DocumentMetadata(data={"section": "finance"})),
            _item("b", text="y", metadata=DocumentMetadata(data={"section": "legal"})),
            _item("c", text="z"),
        ],
    )

    assert _routed(outputs, _branch_port("finance")) == ["a"]
    assert _routed(outputs, UNMATCHED_PORT) == ["b", "c"]


def test_a_branch_expression_that_cannot_parse_fails_the_node() -> None:
    """The typed failure — a router that cannot test cannot honestly route."""
    node = _router(("broken", "Broken", "item.has_text and"))

    with pytest.raises(RouterBranchError, match="Broken"):
        _run(node, [_item("a", text="hello")])


def test_a_branch_expression_that_does_not_answer_a_boolean_fails_the_node() -> None:
    """A non-boolean test would route by truthiness, which nothing declared."""
    node = _router(("broken", "Broken", "item.text_length"))

    with pytest.raises(RouterBranchError, match="true or false"):
        _run(node, [_item("a", text="hello")])


def test_items_keep_every_facet_they_arrived_with() -> None:
    """Routing sorts items; it never rewrites them."""
    node = _router(("all", "All", "item.has_text"))
    item = _item("a", text="hello", score=0.5, embedding=[0.1, 0.2], document_id="doc-1")
    outputs = _run(node, [item])

    routed = ItemBatch.model_validate(outputs[_branch_port("all")]).items[0]
    assert routed == item


def _definition(branches: list[dict[str, str]], edge_port: str) -> PipelineDefinition:
    """A router wired to a deduplicate node through `edge_port`."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="router", type=RouterNode.type, name="Router", config={"branches": branches}
            ),
            PipelineNodeDefinition(id="sink", type="filter.dedupe", name="Dedupe", config={}),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1", source="router", source_port=edge_port, target="sink", target_port="items"
            )
        ],
    )


def test_an_edge_from_a_configured_branch_port_validates() -> None:
    """A config-derived port is a real port to the graph checks, not just the canvas."""
    definition = _definition(
        [{"id": "b1", "name": "Images", "expression": "item.has_image"}], "branch:b1"
    )
    result = PipelineValidator(build_default_registry()).validate(definition)

    assert not [issue for issue in result.issues if issue.code == "graph.edge_port"]


def test_an_edge_from_a_branch_that_no_longer_exists_is_reported() -> None:
    """Deleting a branch must surface its orphaned wire, not silently keep it."""
    definition = _definition(
        [{"id": "b1", "name": "Images", "expression": "item.has_image"}], "branch:gone"
    )
    result = PipelineValidator(build_default_registry()).validate(definition)

    assert [issue for issue in result.issues if issue.code == "graph.edge_port"]


def test_a_branch_expression_error_is_reported_at_save_time() -> None:
    """A router failing per item on the next run is found before it is saved."""
    definition = _definition(
        [{"id": "b1", "name": "Images", "expression": "item.nope"}], "branch:b1"
    )
    result = PipelineValidator(build_default_registry()).validate(definition)

    assert [issue for issue in result.issues if issue.code == "router.branch_expression"]


def test_two_branches_sharing_an_id_are_reported() -> None:
    """They share one port, so the second branch could never receive anything."""
    definition = _definition(
        [
            {"id": "b1", "name": "First", "expression": "item.has_image"},
            {"id": "b1", "name": "Second", "expression": "item.has_text"},
        ],
        "branch:b1",
    )
    result = PipelineValidator(build_default_registry()).validate(definition)

    assert [issue for issue in result.issues if issue.code == "router.duplicate_branch"]


def test_a_derived_port_is_keyed_by_id_and_labelled_by_name() -> None:
    """Renaming a branch keeps its key, so wired edges survive the rename."""
    spec = RouterNode.spec()
    before = derived_output_ports(
        spec.dynamic_output_ports, {"branches": [{"id": "b1", "name": "Images"}]}
    )
    after = derived_output_ports(
        spec.dynamic_output_ports, {"branches": [{"id": "b1", "name": "Pictures"}]}
    )

    assert [port.key for port in before] == [port.key for port in after] == ["branch:b1"]
    assert [port.label for port in before] == ["Images"]
    assert [port.label for port in after] == ["Pictures"]


def test_derived_ports_come_before_the_declared_unmatched_port() -> None:
    """Branches read in evaluation order with the fallback last, as on the canvas."""
    spec = RouterNode.spec()
    node = PipelineNodeDefinition(
        id="router",
        type=RouterNode.type,
        name="Router",
        config={"branches": [{"id": "b1", "name": "Images"}, {"id": "b2", "name": "Text"}]},
    )

    keys = [
        port.key
        for port in resolve_output_ports(spec.output_ports, spec.dynamic_output_ports, node)
    ]
    assert keys == ["branch:b1", "branch:b2", UNMATCHED_PORT]


def test_a_branch_entry_with_no_id_contributes_no_port() -> None:
    """An unaddressable port would draw a handle no edge could ever name."""
    spec = RouterNode.spec()
    ports = derived_output_ports(spec.dynamic_output_ports, {"branches": [{"name": "Images"}]})

    assert ports == []
