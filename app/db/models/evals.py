"""Eval tables: benchmark datasets (corpus/queries/qrels) and evaluation runs.

An `EvalDataset` plus its `EvalDatasetDocument` / `EvalDatasetQuery` /
`EvalRelevanceJudgment` rows are the normalized BEIR triple. An `EvalRun` records
one evaluation of an `(ingestion pipeline, retrieval pipeline)` pair against a
dataset, and each `EvalRunItem` is one evaluated query -- persisted as it
completes so a run is restart-resilient and reports live progress.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, DateTime, Integer, String, Text
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class EvalDataset(SQLModel, TimestampMixin, table=True):
    """A benchmark or uploaded golden dataset the run engine evaluates against."""

    __tablename__ = "eval_datasets"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    source: str = Field(sa_column=Column(String, nullable=False))
    source_ref: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    relevance_granularity: str = Field(
        default="document", sa_column=Column(String, nullable=False)
    )
    status: str = Field(default="pending", sa_column=Column(String, nullable=False))
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    num_queries: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    num_corpus_docs: int = Field(default=0, sa_column=Column(Integer, nullable=False))


class EvalDatasetDocument(SQLModel, table=True):
    """One corpus document within an eval dataset (keyed by its external id)."""

    __tablename__ = "eval_dataset_documents"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    dataset_id: UUID = Field(foreign_key="eval_datasets.id", nullable=False, index=True)
    external_doc_id: str = Field(sa_column=Column(String, nullable=False, index=True))
    title: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    text: str = Field(sa_column=Column(Text, nullable=False))
    doc_metadata: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON, nullable=False)
    )


class EvalDatasetQuery(SQLModel, table=True):
    """One query within an eval dataset (keyed by its external id)."""

    __tablename__ = "eval_dataset_queries"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    dataset_id: UUID = Field(foreign_key="eval_datasets.id", nullable=False, index=True)
    external_query_id: str = Field(sa_column=Column(String, nullable=False, index=True))
    text: str = Field(sa_column=Column(Text, nullable=False))


class EvalRelevanceJudgment(SQLModel, table=True):
    """One qrel: a (query, document) relevance grade within an eval dataset."""

    __tablename__ = "eval_relevance_judgments"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    dataset_id: UUID = Field(foreign_key="eval_datasets.id", nullable=False, index=True)
    query_external_id: str = Field(sa_column=Column(String, nullable=False, index=True))
    doc_external_id: str = Field(sa_column=Column(String, nullable=False, index=True))
    relevance: int = Field(default=1, sa_column=Column(Integer, nullable=False))


class EvalRun(SQLModel, TimestampMixin, table=True):
    """One evaluation of an (ingestion, retrieval) pipeline pair against a dataset."""

    __tablename__ = "eval_runs"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    dataset_id: UUID = Field(foreign_key="eval_datasets.id", nullable=False, index=True)
    eval_collection_id: UUID | None = Field(
        default=None, foreign_key="collections.id", nullable=True, index=True
    )
    ingestion_pipeline_id: UUID = Field(
        foreign_key="pipelines.id", nullable=False, index=True
    )
    retrieval_pipeline_id: UUID = Field(
        foreign_key="pipelines.id", nullable=False, index=True
    )
    name: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    status: str = Field(default="pending", sa_column=Column(String, nullable=False))
    progress_done: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    progress_total: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    aggregate_metrics: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON, nullable=False)
    )
    funnel_summary: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON, nullable=False)
    )
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    completed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )


class EvalRunItem(SQLModel, table=True):
    """One evaluated query within a run, persisted the moment it completes."""

    __tablename__ = "eval_run_items"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    run_id: UUID = Field(foreign_key="eval_runs.id", nullable=False, index=True)
    query_external_id: str = Field(sa_column=Column(String, nullable=False))
    query_text: str = Field(sa_column=Column(Text, nullable=False))
    pipeline_run_id: UUID | None = Field(
        default=None, foreign_key="pipeline_runs.id", nullable=True, index=True
    )
    query_event_id: UUID | None = Field(
        default=None, foreign_key="query_events.id", nullable=True, index=True
    )
    result_count: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    gold_doc_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    retrieved: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    metrics: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    per_node_funnel: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    failed: bool = Field(default=False, nullable=False)
    error_message: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
