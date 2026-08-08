"""Router node: first-match branching, the unmatched port, and dynamic ports."""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutor
from app.pipelines.node import EmptyConfig, PipelineNodeBase
from app.pipelines.node_ports import derived_output_ports, resolve_output_ports
from app.pipelines.nodes.routing import (
    BRANCH_PORT_PREFIX,
    UNMATCHED_PORT,
    RouterBranchError,
    RouterConfig,
    RouterNode,
)
from app.pipelines.payloads import Item, ItemBatch, MediaAsset
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.registry import NodeRegistry, build_default_registry
from app.pipelines.tracing import NodeTraceSummary
from app.pipelines.validation import PipelineValidator
from app.retrieval.models import DocumentMetadata
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider


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


class _StreamSink(PipelineNodeBase[EmptyConfig]):
    """A terminal that records the item ids one branch delivered to it."""

    type = "test.stream_sink"
    label = "Sink"
    category = "test"
    description = "Records the ids of the items it received."
    example = "Items(a) -> ['a']."
    input_ports = (NodePort(key="items", label="Items", data_type=PortKind.ITEMS),)
    output_ports = (NodePort(key="ids", label="Ids", data_type=PortKind.STRUCTURED_VALUES),)
    config_model = EmptyConfig

    def run(self, inputs: dict[str, object], _context: PipelineRunContext) -> dict[str, object]:
        return {"ids": [item.id for item in ItemBatch.model_validate(inputs.get("items")).items]}

    def summarize_io(
        self, inputs: dict[str, object], outputs: dict[str, object]
    ) -> NodeTraceSummary:
        return NodeTraceSummary()  # pragma: no cover - executed without tracing


class _StreamSource(PipelineNodeBase[EmptyConfig]):
    """Emits one image item and one short text item."""

    type = "test.stream_source"
    label = "Source"
    category = "test"
    description = "Emits a fixed two-item stream."
    example = "-> Items(pic, note)."
    input_ports = ()
    output_ports = (
        NodePort(key="items", label="Items", data_type=PortKind.ITEMS, adds=(Facet.TEXT,)),
    )
    config_model = EmptyConfig

    def run(self, _inputs: dict[str, object], _context: PipelineRunContext) -> dict[str, object]:
        return {
            "items": ItemBatch(
                items=[
                    Item(
                        id="pic",
                        text="caption",
                        image=MediaAsset(media_type="image/png", path="p", byte_size=1),
                    ),
                    Item(id="note", text="a note"),
                ]
            )
        }

    def summarize_io(
        self, inputs: dict[str, object], outputs: dict[str, object]
    ) -> NodeTraceSummary:
        return NodeTraceSummary()  # pragma: no cover - executed without tracing


def _routed_graph(branches: list[dict[str, str]]) -> PipelineDefinition:
    """source -> router, with every router port wired to its own sink."""
    ports = [f"branch:{branch['id']}" for branch in branches] + [UNMATCHED_PORT]
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type=_StreamSource.type, name="Source"),
            PipelineNodeDefinition(
                id="router", type=RouterNode.type, name="Router", config={"branches": branches}
            ),
            *(
                PipelineNodeDefinition(id=f"sink-{port}", type=_StreamSink.type, name=port)
                for port in ports
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="feed",
                source="source",
                source_port="items",
                target="router",
                target_port="items",
            ),
            *(
                PipelineEdgeDefinition(
                    id=f"e-{port}",
                    source="router",
                    source_port=port,
                    target=f"sink-{port}",
                    target_port="items",
                )
                for port in ports
            ),
        ],
    )


def test_a_run_delivers_each_branch_to_its_own_downstream_node(session: Session) -> None:
    """The whole point: the graph splits, and each side sees only its items."""
    definition = _routed_graph(
        [
            {"id": "img", "name": "Images", "expression": "item.has_image"},
            {"id": "txt", "name": "Text", "expression": "item.has_text"},
        ]
    )
    registry = NodeRegistry([_StreamSource, RouterNode, _StreamSink])

    result = PipelineExecutor(registry).execute(definition, _router_context(session))

    assert result.outputs_by_node["sink-branch:img"]["ids"] == ["pic"]
    assert result.outputs_by_node["sink-branch:txt"]["ids"] == ["note"]
    assert result.outputs_by_node[f"sink-{UNMATCHED_PORT}"]["ids"] == []


def test_a_branch_that_matched_nothing_still_runs_its_downstream_node(session: Session) -> None:
    """An empty branch is an empty stream, not a skipped subgraph."""
    definition = _routed_graph([{"id": "none", "name": "None", "expression": "item.has_embedding"}])
    registry = NodeRegistry([_StreamSource, RouterNode, _StreamSink])

    result = PipelineExecutor(registry).execute(definition, _router_context(session))

    assert result.outputs_by_node["sink-branch:none"]["ids"] == []
    assert result.outputs_by_node[f"sink-{UNMATCHED_PORT}"]["ids"] == ["pic", "note"]


def _router_context(session: Session) -> PipelineRunContext:
    """A minimal run context; the router reads nothing off it."""
    user = models.User(email="router@example.com", full_name="Router", hashed_password="hashed")
    return PipelineRunContext(
        session=session,
        user=user,
        collection=models.Collection(
            user_id=user.id, name="Test", description="", extra_metadata={}
        ),
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(),
        storage=FileStorage(),
        settings=get_settings(),
        trace=None,
    )


def test_an_unwired_input_fails_as_the_node_s_own_error() -> None:
    """A raw ValidationError names a payload shape, not the graph's real problem."""
    node = _router(("all", "All", "item.has_text"))

    with pytest.raises(RouterBranchError, match="connect a stream"):
        node.run({}, None)  # type: ignore[arg-type]
