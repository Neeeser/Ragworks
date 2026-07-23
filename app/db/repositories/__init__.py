"""Database repositories, re-exported as a flat namespace.

The repositories live one-per-domain in sibling modules (`user`, `collection`,
`document`, `chat`, `pipeline`, `query`), all built on `base.Repository`; this
module re-exports every repository class so existing call sites keep working
unchanged: `from app.db.repositories import ChatRepository` is a permanent,
supported import shape -- not a temporary shim. New repositories get added to
their domain module and re-exported here.
"""

from __future__ import annotations

from app.db.repositories.app_setting import AppSettingRepository
from app.db.repositories.base import Repository
from app.db.repositories.chat import ChatRepository
from app.db.repositories.bindings import CollectionPipelineBindingRepository
from app.db.repositories.collection import CollectionRepository
from app.db.repositories.collection_stats import (
    HISTORY_WINDOWS,
    CollectionStats,
    CollectionStatsRepository,
    HistoryWindow,
)
from app.db.repositories.document import ChunkRepository, DocumentRepository
from app.db.repositories.evals import EvalDatasetRepository, EvalRunRepository
from app.db.repositories.files import FileNodeRepository
from app.db.repositories.pipeline import (
    PipelineRepository,
    PipelineRunRepository,
    PipelineVersionRepository,
)
from app.db.repositories.provider import ProviderConnectionRepository
from app.db.repositories.query import QueryRepository
from app.db.repositories.telemetry import TelemetryRepository
from app.db.repositories.user import AuthSessionRepository, UserRepository

__all__ = [
    "HISTORY_WINDOWS",
    "AppSettingRepository",
    "AuthSessionRepository",
    "ChatRepository",
    "ChunkRepository",
    "CollectionPipelineBindingRepository",
    "CollectionRepository",
    "CollectionStats",
    "CollectionStatsRepository",
    "DocumentRepository",
    "EvalDatasetRepository",
    "EvalRunRepository",
    "FileNodeRepository",
    "HistoryWindow",
    "PipelineRepository",
    "PipelineRunRepository",
    "PipelineVersionRepository",
    "ProviderConnectionRepository",
    "QueryRepository",
    "Repository",
    "TelemetryRepository",
    "UserRepository",
]
