from __future__ import annotations

from dataclasses import dataclass

import pytest
from sqlmodel import Session

from app.db import models
from app.pipelines.models import PipelineDefinition, PipelineEdgeDefinition, PipelineNodeDefinition
from app.pipelines.runtime import (
    EmptyConfig,
    NodePort,
    NodeRegistry,
    PipelineExecutor,
    PipelineExecutionError,
    PipelineNodeBase,
    PipelineRunContext,
    PipelineValidator,
)
from app.api.config import get_settings
from app.utils.file_storage import FileStorage


class _InputNode(PipelineNodeBase):
    type = "test.input"
    label = "Input"
    category = "test"
    description = "Input node"
    example = "Input -> Output."
    input_ports = []
    output_ports = [NodePort(key="out", label="Out", data_type="text")]

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
    input_ports = []
    output_ports = [
        NodePort(key="a", label="A", data_type="text"),
        NodePort(key="b", label="B", data_type="text"),
    ]

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
    input_ports = [
        NodePort(key="a", label="A", data_type="text"),
        NodePort(key="b", label="B", data_type="text"),
    ]
    output_ports = [NodePort(key="out", label="Out", data_type="text")]

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
    input_ports = []
    output_ports = []

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        raise RuntimeError("boom")

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _TraceNode(PipelineNodeBase):
    type = "test.trace"
    label = "Trace"
    category = "test"
    description = "Trace node"
    example = "Input -> Output."
    input_ports = []
    output_ports = [NodePort(key="out", label="Out", data_type="text")]

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": "payload"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return object()


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


class _BlankSpecNode(PipelineNodeBase):
    type = "test.blank"
    label = "Blank"
    category = "test"
    description = " "
    example = " "
    input_ports = []
    output_ports = []


class _MissingExampleNode(PipelineNodeBase):
    type = "test.missing_example"
    label = "Missing"
    category = "test"
    description = "Has description"
    example = ""
    input_ports = []
    output_ports = []


class _MissingDescriptionNode(PipelineNodeBase):
    type = "test.missing_desc"
    label = "Missing"
    category = "test"
    description = ""
    example = "Example"
    input_ports = []
    output_ports = []


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
        openrouter=object(),
        pinecone=object(),
        storage=FileStorage(),
        settings=get_settings(),
        trace=trace,
    )


def test_pipeline_node_base_spec_requires_description_and_example() -> None:
    with pytest.raises(ValueError, match="must define a description"):
        _MissingDescriptionNode.spec()
    with pytest.raises(ValueError, match="must define an example"):
        _MissingExampleNode.spec()
    with pytest.raises(ValueError, match="must define a description"):
        _BlankSpecNode.spec()


def test_node_registry_create_unknown_type_raises() -> None:
    registry = NodeRegistry([_InputNode])
    with pytest.raises(ValueError, match="Unknown node type"):
        registry.create(PipelineNodeDefinition(id="x", type="missing", name="Missing"))


def test_pipeline_validator_collects_errors() -> None:
    registry = NodeRegistry([_InputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="dup", type="test.input", name="First"),
            PipelineNodeDefinition(id="dup", type="unknown", name="Second"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge", source="missing", target="also-missing", source_port="out"
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("Duplicate node ids" in error for error in result.errors)
    assert any("Unknown node type" in error for error in result.errors)
    assert any("unknown source" in error for error in result.errors)
    assert any("unknown target" in error for error in result.errors)


def test_pipeline_validator_detects_ports_and_missing_inputs() -> None:
    registry = NodeRegistry([_InputNode, _DoubleInputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.input", name="Input"),
            PipelineNodeDefinition(id="double", type="test.double", name="Double"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge",
                source="input",
                target="double",
                source_port="missing",
                target_port="a",
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("missing output port" in error for error in result.errors)
    assert any("missing inbound edges" in error for error in result.errors)


def test_pipeline_validator_detects_missing_input_port() -> None:
    registry = NodeRegistry([_InputNode, _DoubleInputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.input", name="Input"),
            PipelineNodeDefinition(id="double", type="test.double", name="Double"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge",
                source="input",
                target="double",
                source_port="out",
                target_port="missing",
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("missing input port" in error for error in result.errors)


def test_pipeline_validator_detects_cycles() -> None:
    registry = NodeRegistry([_InputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="a", type="test.input", name="A"),
            PipelineNodeDefinition(id="b", type="test.input", name="B"),
        ],
        edges=[
            PipelineEdgeDefinition(id="edge-a", source="a", target="b"),
            PipelineEdgeDefinition(id="edge-b", source="b", target="a"),
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("cycle" in error.lower() for error in result.errors)


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


def test_pipeline_executor_invalid_definition_without_trace(session: Session) -> None:
    registry = NodeRegistry([_InputNode])
    executor = PipelineExecutor(registry)
    definition = PipelineDefinition(
        nodes=[PipelineNodeDefinition(id="a", type="unknown", name="Missing")],
        edges=[],
    )
    context = _build_context(session, trace=None)

    with pytest.raises(PipelineExecutionError):
        executor.execute(definition, context)


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


def test_pipeline_executor_handles_failure_without_trace(session: Session) -> None:
    registry = NodeRegistry([_FailingNode])
    executor = PipelineExecutor(registry)
    definition = PipelineDefinition(nodes=[PipelineNodeDefinition(id="a", type="test.fail", name="Fail")])
    context = _build_context(session, trace=None)

    with pytest.raises(RuntimeError):
        executor.execute(definition, context)


def test_pipeline_executor_finishes_trace(session: Session) -> None:
    registry = NodeRegistry([_TraceNode])
    executor = PipelineExecutor(registry)
    definition = PipelineDefinition(nodes=[PipelineNodeDefinition(id="a", type="test.trace", name="Trace")])
    trace = _TraceRecorder(failed=[])
    context = _build_context(session, trace=trace)

    executor.execute(definition, context)

    assert trace.completed == 1
    assert trace.started == 1
    assert trace.finished == 1


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


def test_execute_nodes_raises_for_missing_node_spec(session: Session) -> None:
    registry = NodeRegistry([_InputNode])
    executor = PipelineExecutor(registry)
    definition = PipelineDefinition(
        nodes=[PipelineNodeDefinition(id="missing", type="unknown", name="Missing")],
        edges=[],
    )
    context = _build_context(session)

    with pytest.raises(PipelineExecutionError, match="not found"):
        executor._execute_nodes(definition, context)


def test_pipeline_node_base_methods_raise_not_implemented(session: Session) -> None:
    base = PipelineNodeBase(EmptyConfig())
    with pytest.raises(NotImplementedError):
        base.run({}, _build_context(session))
    with pytest.raises(NotImplementedError):
        base.summarize_io({}, {})
