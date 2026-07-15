"""Pipeline tables: definitions, versions, runs, and per-node run/IO records."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, Float, String, Text
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import PipelineIOType, PipelineKind, PipelineRunStatus
from app.utils.time import utc_now


class Pipeline(SQLModel, TimestampMixin, table=True):
    """User-defined pipeline for ingestion or retrieval."""

    __tablename__ = "pipelines"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    kind: PipelineKind = Field(sa_column=Column(String, nullable=False, index=True))
    current_version: int = Field(default=1, nullable=False)
    is_default: bool = Field(default=False, nullable=False)


class PipelineVersion(SQLModel, TimestampMixin, table=True):
    """Stored pipeline definition revision."""

    __tablename__ = "pipeline_versions"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    pipeline_id: UUID = Field(foreign_key="pipelines.id", nullable=False, index=True)
    version: int = Field(nullable=False, index=True)
    definition: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    change_summary: str | None = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
    )
    created_by: UUID | None = Field(
        default=None,
        foreign_key="users.id",
        nullable=True,
        index=True,
    )


class PipelineRun(SQLModel, TimestampMixin, table=True):
    """Recorded pipeline execution trace metadata."""

    __tablename__ = "pipeline_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    pipeline_id: UUID = Field(foreign_key="pipelines.id", nullable=False, index=True)
    pipeline_version_id: UUID | None = Field(
        default=None,
        foreign_key="pipeline_versions.id",
        nullable=True,
        index=True,
    )
    pipeline_version: int | None = Field(default=None, nullable=True)
    kind: PipelineKind = Field(sa_column=Column(String, nullable=False, index=True))
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    status: PipelineRunStatus = Field(
        default=PipelineRunStatus.RUNNING,
        sa_column=Column(String, nullable=False),
    )
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    warnings: list[str] = Field(
        default_factory=list,
        sa_column=Column(JSON, nullable=False),
    )
    started_at: datetime = Field(default_factory=utc_now, nullable=False)
    completed_at: datetime | None = Field(default=None, nullable=True)


class PipelineNodeRun(SQLModel, TimestampMixin, table=True):
    """Recorded execution details for a pipeline node."""

    __tablename__ = "pipeline_node_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    run_id: UUID = Field(foreign_key="pipeline_runs.id", nullable=False, index=True)
    node_id: str = Field(sa_column=Column(String, nullable=False, index=True))
    node_type: str = Field(sa_column=Column(String, nullable=False))
    node_name: str = Field(sa_column=Column(String, nullable=False))
    sequence_index: int = Field(nullable=False, index=True)
    status: PipelineRunStatus = Field(
        default=PipelineRunStatus.RUNNING,
        sa_column=Column(String, nullable=False),
    )
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    summary: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
    started_at: datetime = Field(default_factory=utc_now, nullable=False)
    completed_at: datetime | None = Field(default=None, nullable=True)
    duration_ms: float | None = Field(default=None, sa_column=Column(Float, nullable=True))


class PipelineNodeIO(SQLModel, TimestampMixin, table=True):
    """Input/output payloads captured for pipeline node executions."""

    __tablename__ = "pipeline_node_io"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    run_id: UUID = Field(foreign_key="pipeline_runs.id", nullable=False, index=True)
    node_run_id: UUID = Field(
        foreign_key="pipeline_node_runs.id",
        nullable=False,
        index=True,
    )
    node_id: str = Field(sa_column=Column(String, nullable=False, index=True))
    io_type: PipelineIOType = Field(sa_column=Column(String, nullable=False, index=True))
    port: str = Field(sa_column=Column(String, nullable=False))
    payload: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False),
    )
