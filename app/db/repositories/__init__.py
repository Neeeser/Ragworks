"""Database repositories, re-exported as a flat namespace.

The repositories live one-per-domain in sibling modules (`user`, `collection`,
`document`, `chat`, `pipeline`, `query`), all built on `base.Repository`; this
module re-exports every repository class so existing call sites keep working
unchanged: `from app.db.repositories import ChatRepository` is a permanent,
supported import shape -- not a temporary shim. New repositories get added to
their domain module and re-exported here.
"""

from __future__ import annotations

from app.db.repositories.api_key import ApiKeyRepository
from app.db.repositories.app_setting import AppSettingRepository
from app.db.repositories.base import Repository
from app.db.repositories.bindings import CollectionPipelineBindingRepository
from app.db.repositories.chat import ChatRepository
from app.db.repositories.collection import CollectionRepository
from app.db.repositories.collection_history import (
    BoundTool,
    CollectionHistoryRepository,
    HistoryDomain,
    PipelineChangeMarker,
)
from app.db.repositories.collection_latency import (
    CollectionLatencyRepository,
    LatencyBucketStats,
    LatencySummaryStats,
)
from app.db.repositories.collection_stats import CollectionStats, CollectionStatsRepository
from app.db.repositories.document import ChunkRepository, DocumentRepository
from app.db.repositories.evals import EvalDatasetRepository, EvalRunRepository
from app.db.repositories.files import FileNodeRepository
from app.db.repositories.indexes import RegisteredIndexRepository
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
    "ApiKeyRepository",
    "AppSettingRepository",
    "AuthSessionRepository",
    "BoundTool",
    "ChatRepository",
    "ChunkRepository",
    "CollectionHistoryRepository",
    "CollectionLatencyRepository",
    "CollectionPipelineBindingRepository",
    "CollectionRepository",
    "CollectionStats",
    "CollectionStatsRepository",
    "DocumentRepository",
    "EvalDatasetRepository",
    "EvalRunRepository",
    "FileNodeRepository",
    "HistoryDomain",
    "LatencyBucketStats",
    "LatencySummaryStats",
    "PipelineChangeMarker",
    "PipelineRepository",
    "PipelineRunRepository",
    "PipelineVersionRepository",
    "ProviderConnectionRepository",
    "QueryRepository",
    "RegisteredIndexRepository",
    "Repository",
    "TelemetryRepository",
    "UserRepository",
]
