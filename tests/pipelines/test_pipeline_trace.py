from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutor
from app.pipelines.node import PipelineNodeBase
from app.pipelines.ports import NodePort
from app.pipelines.registry import NodeRegistry
from app.pipelines.tracing import (
    NodeTraceSummary,
    NodeTraceValue,
    PipelineTraceRecorder,
    serialize_payload,
)
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubVectorStoreProvider


class InputConfig(BaseModel):
    value: str = "hello trace"


class PayloadModel(BaseModel):
    text: str


class InputNode(PipelineNodeBase):
    type = "test.input"
    label = "Input"
    category = "test"
    description = "Emit a static payload."
    example = "Input() -> Payload(text='hello')."
    input_ports = ()
    output_ports = (NodePort(key="value", label="Value", data_type="payload"),)
    config_model = InputConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        payload = PayloadModel(text=self.config.value)
        return {"value": payload}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize emitted payloads for tracing."""
        return NodeTraceSummary(
            outputs=[
                NodeTraceValue(
                    label="Payload",
                    value={"text": self.config.value},
                )
            ]
        )


class EchoNode(PipelineNodeBase):
    type = "test.echo"
    label = "Echo"
    category = "test"
    description = "Echo the payload."
    example = "Payload(text='hello') -> Payload(text='hello')."
    input_ports = (NodePort(key="value", label="Value", data_type="payload"),)
    output_ports = (NodePort(key="result", label="Result", data_type="payload"),)
    class EchoConfig(BaseModel):
        """Empty config for echo node."""

    config_model = EchoConfig

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"result": inputs["value"]}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize echoed payloads for tracing."""
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Input",
                    value={"text": PayloadModel.model_validate(inputs["value"]).text},
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Output",
                    value={"text": PayloadModel.model_validate(outputs["result"]).text},
                )
            ],
        )


def _create_user(session: Session) -> models.User:
    user = models.User(
        email=f"trace-{uuid4().hex[:6]}@example.com",
        full_name="Trace User",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Trace Collection",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_pipeline_trace_records_node_io(session: Session, tmp_path) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.input", name="Input", config={}),
            PipelineNodeDefinition(id="echo", type="test.echo", name="Echo", config={}),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-1",
                source="input",
                target="echo",
                source_port="value",
                target_port="value",
            )
        ],
    )

    pipeline = models.Pipeline(
        user_id=user.id,
        name="Trace Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.flush()

    version = models.PipelineVersion(
        pipeline_id=pipeline.id,
        version=1,
        definition=definition.model_dump(mode="json"),
        created_by=user.id,
    )
    session.add(version)
    session.flush()

    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=version.id,
        pipeline_version=version.version,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.RUNNING,
    )
    session.add(run)
    session.flush()

    trace = PipelineTraceRecorder(session, run, definition)
    registry = NodeRegistry([InputNode, EchoNode])
    executor = PipelineExecutor(registry)
    context = PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=None,
        query=None,
        top_k=None,
        openrouter=object(),
        vector_stores=StubVectorStoreProvider(),
        storage=FileStorage(base_path=tmp_path),
        settings=get_settings(),
        trace=trace,
    )

    result = executor.execute(definition, context)
    assert "echo" in result.outputs_by_node

    session.commit()

    node_runs = session.exec(select(models.PipelineNodeRun)).all()
    node_io = session.exec(select(models.PipelineNodeIO)).all()
    stored_run = session.get(models.PipelineRun, run.id)

    assert stored_run is not None
    assert stored_run.status == models.PipelineRunStatus.COMPLETED
    assert len(node_runs) == 2
    assert len(node_io) == 3
    assert all(node_run.summary for node_run in node_runs)
    payload_values = [record.payload for record in node_io]
    assert any(payload.get("text") == "hello trace" for payload in payload_values)


def test_serialize_payload_handles_custom_types() -> None:
    payload = {
        "path": Path("/tmp/file.txt"),
        "id": uuid4(),
        "when": datetime(2024, 1, 1, tzinfo=UTC),
    }

    serialized = serialize_payload(payload)

    assert isinstance(serialized["path"], str)
    assert isinstance(serialized["id"], str)
    assert serialized["when"].endswith("+00:00")


def test_trace_recorder_mark_run_failed_is_idempotent(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Trace Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.flush()

    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=1,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.FAILED,
        error_message="existing",
    )
    session.add(run)
    session.flush()

    recorder = PipelineTraceRecorder(session, run, PipelineDefinition())
    recorder.mark_run_failed(RuntimeError("ignored"))

    assert run.status == models.PipelineRunStatus.FAILED
    assert run.error_message == "existing"


def test_trace_recorder_mark_run_completed_is_idempotent(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Trace Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.flush()

    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=1,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
    )
    session.add(run)
    session.flush()

    recorder = PipelineTraceRecorder(session, run, PipelineDefinition())
    recorder.mark_run_completed()

    assert run.status == models.PipelineRunStatus.COMPLETED


def test_trace_recorder_normalizes_non_dict_payloads() -> None:
    payload = PipelineTraceRecorder._normalize_payload([1, 2, 3])

    assert payload["value"] == [1, 2, 3]


def test_trace_recorder_mark_run_failed_sets_status(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Trace Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.flush()

    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=1,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.RUNNING,
    )
    session.add(run)
    session.flush()

    recorder = PipelineTraceRecorder(session, run, PipelineDefinition())
    recorder.mark_run_failed(RuntimeError("boom"))

    assert run.status == models.PipelineRunStatus.FAILED
    assert run.error_message == "boom"


def test_trace_recorder_fail_node_sets_status(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Trace Pipeline",
        kind=models.PipelineKind.INGESTION,
        current_version=1,
    )
    session.add(pipeline)
    session.flush()

    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=1,
        kind=models.PipelineKind.INGESTION,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.RUNNING,
    )
    session.add(run)
    session.flush()

    node_run = models.PipelineNodeRun(
        run_id=run.id,
        node_id="node",
        node_type="type",
        node_name="Node",
        sequence_index=0,
        status=models.PipelineRunStatus.RUNNING,
    )
    session.add(node_run)
    session.flush()

    recorder = PipelineTraceRecorder(session, run, PipelineDefinition())
    recorder.fail_node(node_run, RuntimeError("node failed"))

    assert node_run.status == models.PipelineRunStatus.FAILED
    assert node_run.error_message == "node failed"


def test_trace_recorder_normalizes_base_model() -> None:
    class _Payload(BaseModel):
        value: str

    payload = PipelineTraceRecorder._normalize_payload(_Payload(value="ok"))

    assert payload["value"] == "ok"
