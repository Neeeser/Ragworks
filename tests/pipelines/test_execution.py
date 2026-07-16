"""Behavioral tests for PipelineExecutor: readiness, propagation, and stalls."""

from __future__ import annotations

from dataclasses import dataclass

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
from app.pipelines.execution.executor import PipelineExecutionError, PipelineExecutor
from app.pipelines.node import PipelineNodeBase
from app.pipelines.ports import NodePort
from app.pipelines.registry import NodeRegistry
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider


class _InputNode(PipelineNodeBase):
    type = "test.input"
    label = "Input"
    category = "test"
    description = "Input node"
    example = "Input -> Output."
    input_ports = ()
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": "payload"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None  # pragma: no cover - this node is used without tracing


class _PartialOutputNode(PipelineNodeBase):
    type = "test.partial"
    label = "Partial"
    category = "test"
    description = "Outputs only a subset of ports."
    example = "Input -> {a}."
    input_ports = ()
    output_ports = (
        NodePort(key="a", label="A", data_type="text"),
        NodePort(key="b", label="B", data_type="text"),
    )

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"a": "payload"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _DoubleInputNode(PipelineNodeBase):
    type = "test.double"
    label = "Double"
    category = "test"
    description = "Double input node"
    example = "A+B -> Output."
    input_ports = (
        NodePort(key="a", label="A", data_type="text"),
        NodePort(key="b", label="B", data_type="text"),
    )
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": "ok"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _FailingNode(PipelineNodeBase):
    type = "test.fail"
    label = "Fail"
    category = "test"
    description = "Raises an error."
    example = "Input -> Error."
    input_ports = ()
    output_ports = ()

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        raise RuntimeError("boom")

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _DiamondSourceNode(PipelineNodeBase):
    type = "test.diamond_source"
    label = "Diamond Source"
    category = "test"
    description = "Emits a single value fanned out to two branches."
    example = "-> Output."
    input_ports = ()
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": "seed"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _DiamondBranchNode(PipelineNodeBase):
    type = "test.diamond_branch"
    label = "Diamond Branch"
    category = "test"
    description = "Passes a value through to the join node."
    example = "Input -> Output."
    input_ports = (NodePort(key="in", label="In", data_type="text"),)
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": f"{inputs['in']}-branched"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _DiamondJoinNode(PipelineNodeBase):
    type = "test.diamond_join"
    label = "Diamond Join"
    category = "test"
    description = "Requires both branch outputs before it can run."
    example = "Left+Right -> Result."
    input_ports = (
        NodePort(key="left", label="Left", data_type="text"),
        NodePort(key="right", label="Right", data_type="text"),
    )
    output_ports = (NodePort(key="result", label="Result", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"result": f"{inputs['left']}+{inputs['right']}"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _FanoutSourceNode(PipelineNodeBase):
    type = "test.fanout_source"
    label = "Fanout Source"
    category = "test"
    description = "Emits a single output consumed by several targets."
    example = "-> Output."
    input_ports = ()
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": "shared"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _FanoutSinkNode(PipelineNodeBase):
    type = "test.fanout_sink"
    label = "Fanout Sink"
    category = "test"
    description = "Echoes whatever it receives."
    example = "Input -> Output."
    input_ports = (NodePort(key="in", label="In", data_type="text"),)
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": inputs["in"]}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _ManyJoinNode(PipelineNodeBase):
    type = "test.many_join"
    label = "Many Join"
    category = "test"
    description = "Collects any number of inbound results on one port."
    example = "[A, B] -> Output."
    input_ports = (
        NodePort(key="items", label="Items", data_type="text", accepts_many=True),
    )
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        items = inputs["items"]
        assert isinstance(items, list)
        return {"out": sorted(str(item) for item in items)}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _OrderedManyJoinNode(_ManyJoinNode):
    type = "test.ordered_many_join"

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        items = inputs["items"]
        assert isinstance(items, list)
        return {"out": [str(item) for item in items]}


@dataclass
class _TraceRecorder:
    failed: list[Exception]
    completed: int = 0
    started: int = 0
    finished: int = 0
    failed_nodes: int = 0

    def mark_run_failed(self, exc: Exception) -> None:
        self.failed.append(exc)

    def mark_run_completed(self) -> None:
        self.completed += 1

    def start_node(self, *_args, **_kwargs):
        self.started += 1
        return object()

    def finish_node(self, *_args, **_kwargs):
        self.finished += 1

    def fail_node(self, *_args, **_kwargs):
        self.failed_nodes += 1


def _build_context(session: Session, trace=None) -> PipelineRunContext:
    user = models.User(email="runtime@example.com", full_name="Runtime", hashed_password="hashed")
    collection = models.Collection(user_id=user.id, name="Test", description="", extra_metadata={})
    return PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(),
        storage=FileStorage(),
        settings=get_settings(),
        trace=trace,
    )


def test_pipeline_executor_marks_failed_on_invalid_definition(session: Session) -> None:
    registry = NodeRegistry([_InputNode])
    executor = PipelineExecutor(registry)
    definition = PipelineDefinition(
        nodes=[PipelineNodeDefinition(id="a", type="unknown", name="Missing")],
        edges=[],
    )
    trace = _TraceRecorder(failed=[])
    context = _build_context(session, trace=trace)

    with pytest.raises(PipelineExecutionError):
        executor.execute(definition, context)

    assert trace.failed


def test_pipeline_executor_handles_node_failure(session: Session) -> None:
    registry = NodeRegistry([_FailingNode])
    executor = PipelineExecutor(registry)
    definition = PipelineDefinition(nodes=[PipelineNodeDefinition(id="a", type="test.fail", name="Fail")])
    trace = _TraceRecorder(failed=[])
    context = _build_context(session, trace=trace)

    with pytest.raises(RuntimeError):
        executor.execute(definition, context)

    assert trace.failed
    assert trace.failed_nodes == 1


def test_pipeline_executor_stalls_when_partial_inputs(session: Session) -> None:
    registry = NodeRegistry([_PartialOutputNode, _DoubleInputNode])
    executor = PipelineExecutor(registry)
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.partial", name="Input"),
            PipelineNodeDefinition(id="double", type="test.double", name="Double"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge",
                source="input",
                target="double",
                source_port="a",
                target_port="a",
            ),
            PipelineEdgeDefinition(
                id="edge-b",
                source="input",
                target="double",
                source_port="b",
                target_port="b",
            ),
        ],
    )
    context = _build_context(session)

    with pytest.raises(PipelineExecutionError, match="Pipeline stalled"):
        executor.execute(definition, context)


def test_pipeline_executor_joins_diamond_topology_when_both_branches_ready(
    session: Session,
) -> None:
    """A join node with two required inputs waits for both upstream branches."""
    registry = NodeRegistry([_DiamondSourceNode, _DiamondBranchNode, _DiamondJoinNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.diamond_source", name="Source"),
            PipelineNodeDefinition(id="branch-a", type="test.diamond_branch", name="Branch A"),
            PipelineNodeDefinition(id="branch-b", type="test.diamond_branch", name="Branch B"),
            PipelineNodeDefinition(id="join", type="test.diamond_join", name="Join"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-source-a",
                source="source",
                target="branch-a",
                source_port="out",
                target_port="in",
            ),
            PipelineEdgeDefinition(
                id="edge-source-b",
                source="source",
                target="branch-b",
                source_port="out",
                target_port="in",
            ),
            PipelineEdgeDefinition(
                id="edge-a-join",
                source="branch-a",
                target="join",
                source_port="out",
                target_port="left",
            ),
            PipelineEdgeDefinition(
                id="edge-b-join",
                source="branch-b",
                target="join",
                source_port="out",
                target_port="right",
            ),
        ],
    )
    executor = PipelineExecutor(registry)
    context = _build_context(session)

    result = executor.execute(definition, context)

    assert result.outputs_by_node["join"]["result"] == "seed-branched+seed-branched"
    assert "join" in result.terminal_outputs


def test_pipeline_executor_propagates_one_output_to_multiple_targets(session: Session) -> None:
    """A single output port can fan out to several downstream nodes."""
    registry = NodeRegistry([_FanoutSourceNode, _FanoutSinkNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.fanout_source", name="Source"),
            PipelineNodeDefinition(id="sink-a", type="test.fanout_sink", name="Sink A"),
            PipelineNodeDefinition(id="sink-b", type="test.fanout_sink", name="Sink B"),
            PipelineNodeDefinition(id="sink-c", type="test.fanout_sink", name="Sink C"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-a",
                source="source",
                target="sink-a",
                source_port="out",
                target_port="in",
            ),
            PipelineEdgeDefinition(
                id="edge-b",
                source="source",
                target="sink-b",
                source_port="out",
                target_port="in",
            ),
            PipelineEdgeDefinition(
                id="edge-c",
                source="source",
                target="sink-c",
                source_port="out",
                target_port="in",
            ),
        ],
    )
    executor = PipelineExecutor(registry)
    context = _build_context(session)

    result = executor.execute(definition, context)

    assert result.terminal_outputs["sink-a"]["out"] == "shared"
    assert result.terminal_outputs["sink-b"]["out"] == "shared"
    assert result.terminal_outputs["sink-c"]["out"] == "shared"


def test_accepts_many_port_collects_every_inbound_edge_before_running(
    session: Session,
) -> None:
    """A variadic port waits for all wired edges and receives them as a list."""
    registry = NodeRegistry([_InputNode, _DiamondSourceNode, _ManyJoinNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source-a", type="test.input", name="Source A"),
            PipelineNodeDefinition(id="source-b", type="test.diamond_source", name="Source B"),
            PipelineNodeDefinition(id="join", type="test.many_join", name="Join"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-a",
                source="source-a",
                target="join",
                source_port="out",
                target_port="items",
            ),
            PipelineEdgeDefinition(
                id="edge-b",
                source="source-b",
                target="join",
                source_port="out",
                target_port="items",
            ),
        ],
    )
    executor = PipelineExecutor(registry)
    context = _build_context(session)

    result = executor.execute(definition, context)

    assert result.terminal_outputs["join"]["out"] == ["payload", "seed"]


def test_accepts_many_port_preserves_definition_edge_order(session: Session) -> None:
    """Variadic values keep wire order even when a later edge delivers first."""
    registry = NodeRegistry([_DiamondSourceNode, _DiamondBranchNode, _OrderedManyJoinNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.diamond_source", name="Source"),
            PipelineNodeDefinition(id="branch", type="test.diamond_branch", name="Branch"),
            PipelineNodeDefinition(id="join", type="test.ordered_many_join", name="Join"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="branch-first",
                source="branch",
                target="join",
                source_port="out",
                target_port="items",
            ),
            PipelineEdgeDefinition(
                id="source-second",
                source="source",
                target="join",
                source_port="out",
                target_port="items",
            ),
            PipelineEdgeDefinition(
                id="source-to-branch",
                source="source",
                target="branch",
                source_port="out",
                target_port="in",
            ),
        ],
    )

    result = PipelineExecutor(registry).execute(definition, _build_context(session))

    assert result.terminal_outputs["join"]["out"] == ["seed-branched", "seed"]


def test_accepts_many_port_runs_with_delivered_branches_when_one_never_fires(
    session: Session,
) -> None:
    """A variadic join fuses the branches that delivered when another can never fire.

    A router-style node that emits only one of its output ports leaves the
    other branch undelivered; the fan-in must run with what arrived instead
    of stalling the whole pipeline.
    """
    registry = NodeRegistry([_PartialOutputNode, _FanoutSinkNode, _ManyJoinNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="router", type="test.partial", name="Router"),
            PipelineNodeDefinition(id="branch-a", type="test.fanout_sink", name="Branch A"),
            PipelineNodeDefinition(id="branch-b", type="test.fanout_sink", name="Branch B"),
            PipelineNodeDefinition(id="join", type="test.many_join", name="Join"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-a",
                source="router",
                target="branch-a",
                source_port="a",
                target_port="in",
            ),
            PipelineEdgeDefinition(
                id="edge-b",
                source="router",
                target="branch-b",
                source_port="b",
                target_port="in",
            ),
            PipelineEdgeDefinition(
                id="edge-a-join",
                source="branch-a",
                target="join",
                source_port="out",
                target_port="items",
            ),
            PipelineEdgeDefinition(
                id="edge-b-join",
                source="branch-b",
                target="join",
                source_port="out",
                target_port="items",
            ),
        ],
    )
    executor = PipelineExecutor(registry)
    context = _build_context(session)

    result = executor.execute(definition, context)

    assert result.terminal_outputs["join"]["out"] == ["payload"]


def test_accepts_many_port_with_single_edge_still_receives_a_list(
    session: Session,
) -> None:
    """One inbound edge into a variadic port arrives as a one-item list."""
    registry = NodeRegistry([_InputNode, _ManyJoinNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.input", name="Source"),
            PipelineNodeDefinition(id="join", type="test.many_join", name="Join"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge",
                source="source",
                target="join",
                source_port="out",
                target_port="items",
            ),
        ],
    )
    executor = PipelineExecutor(registry)
    context = _build_context(session)

    result = executor.execute(definition, context)

    assert result.terminal_outputs["join"]["out"] == ["payload"]
