"""Execution context shared by pipeline nodes at runtime."""

from __future__ import annotations

from dataclasses import dataclass

from sqlmodel import Session

from app.core.config import Settings
from app.db import models
from app.pipelines.tracing import PipelineTraceRecorder
from app.providers.registry import ProviderResolver
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import VectorStoreProvider


@dataclass
class PipelineRunContext:
    """Execution context shared by pipeline nodes."""

    session: Session
    user: models.User
    collection: models.Collection
    document: models.Document | None
    query: str | None
    top_k: int | None
    providers: ProviderResolver
    vector_stores: VectorStoreProvider
    storage: FileStorage
    settings: Settings
    trace: PipelineTraceRecorder | None = None
