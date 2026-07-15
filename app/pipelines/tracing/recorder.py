"""Pipeline trace recording helpers."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.utils.time import utc_now


def _serialize_path(value: Path) -> str:
    """Serialize a Path value."""
    return str(value)


def _serialize_uuid(value: UUID) -> str:
    """Serialize a UUID value."""
    return str(value)


def _serialize_datetime(value: datetime) -> str:
    """Serialize a datetime value."""
    return value.isoformat()


def serialize_payload(payload: object) -> object:
    """Serialize payloads into JSON-friendly structures."""
    return jsonable_encoder(
        payload,
        custom_encoder={
            Path: _serialize_path,
            UUID: _serialize_uuid,
            datetime: _serialize_datetime,
        },
    )


class NodeTraceValue(BaseModel):
    """Summary value describing a primary input or output."""

    label: str
    value: object
    kind: Literal["json", "text", "embedding"] = "json"


class NodeTraceSummary(BaseModel):
    """Summary of key inputs and outputs for a pipeline node."""

    inputs: list[NodeTraceValue] = Field(default_factory=list)
    outputs: list[NodeTraceValue] = Field(default_factory=list)


class PipelineTraceRecorder:  # pylint: disable=too-few-public-methods
    """Record pipeline execution inputs, outputs, and status."""

    def __init__(
        self,
        session: Session,
        run: models.PipelineRun,
        definition: PipelineDefinition,
    ) -> None:
        """Initialize the recorder with session, run, and definition."""
        self._session = session
        self._run = run
        self._definition = definition
        self._sequence = 0

    def start_node(
        self,
        node_def: PipelineNodeDefinition,
        inputs: dict[str, object],
    ) -> models.PipelineNodeRun:
        """Record node execution start and its input payloads."""
        node_run = models.PipelineNodeRun(
            run_id=self._run.id,
            node_id=node_def.id,
            node_type=node_def.type,
            node_name=node_def.name,
            sequence_index=self._sequence,
            status=models.PipelineRunStatus.RUNNING,
            started_at=utc_now(),
        )
        self._sequence += 1
        self._session.add(node_run)
        self._session.flush()

        for port, payload in inputs.items():
            self._record_io(node_run, models.PipelineIOType.INPUT, port, payload)
        return node_run

    def finish_node(
        self,
        node_run: models.PipelineNodeRun,
        outputs: dict[str, object],
        summary: NodeTraceSummary,
    ) -> None:
        """Record node execution completion and its outputs."""
        completed_at = utc_now()
        node_run.status = models.PipelineRunStatus.COMPLETED
        node_run.completed_at = completed_at
        node_run.duration_ms = self._duration_ms(node_run.started_at, completed_at)
        node_run.summary = self._normalize_payload(summary)
        self._session.add(node_run)

        for port, payload in outputs.items():
            self._record_io(
                node_run,
                models.PipelineIOType.OUTPUT,
                port,
                payload,
            )

    def fail_node(self, node_run: models.PipelineNodeRun, exc: Exception) -> None:
        """Record a node execution failure."""
        completed_at = utc_now()
        node_run.status = models.PipelineRunStatus.FAILED
        node_run.error_message = str(exc)
        node_run.completed_at = completed_at
        node_run.duration_ms = self._duration_ms(node_run.started_at, completed_at)
        self._session.add(node_run)

    def mark_run_failed(self, exc: Exception) -> None:
        """Mark the overall pipeline run as failed."""
        if self._run.status == models.PipelineRunStatus.FAILED:
            return
        self._run.status = models.PipelineRunStatus.FAILED
        self._run.error_message = str(exc)
        self._run.completed_at = utc_now()
        self._session.add(self._run)

    def mark_run_completed(self) -> None:
        """Mark the overall pipeline run as completed."""
        if self._run.status == models.PipelineRunStatus.COMPLETED:
            return
        self._run.status = models.PipelineRunStatus.COMPLETED
        self._run.completed_at = utc_now()
        self._session.add(self._run)

    def record_warning(self, warning: str) -> None:
        """Append one non-failing run warning using JSON-safe reassignment."""
        self._run.warnings = [*self._run.warnings, warning]
        self._session.add(self._run)

    def _record_io(
        self,
        node_run: models.PipelineNodeRun,
        io_type: models.PipelineIOType,
        port: str,
        payload: object,
    ) -> None:
        """Persist a serialized input/output payload."""
        io_record = models.PipelineNodeIO(
            run_id=self._run.id,
            node_run_id=node_run.id,
            node_id=node_run.node_id,
            io_type=io_type,
            port=port or "default",
            payload=self._normalize_payload(payload),
        )
        self._session.add(io_record)

    @staticmethod
    def _normalize_payload(payload: object) -> dict[str, Any]:
        """Normalize payloads into dicts for persistence."""
        serialized = serialize_payload(payload)
        if isinstance(serialized, dict):
            return serialized
        return {"value": serialized}

    @staticmethod
    def _duration_ms(started_at: datetime, completed_at: datetime) -> float:
        """Return duration in milliseconds between timestamps."""
        return (completed_at - started_at).total_seconds() * 1000
