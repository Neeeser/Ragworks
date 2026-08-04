"""Database models for Ragworks, re-exported as a flat namespace.

The tables live one-per-domain in sibling modules (`user`, `collection`,
`document`, `files`, `pipeline`, `chat`, `visualization`, `events`); this module
re-exports every table class plus the enum aliases below so existing call
sites keep working unchanged: `from app.db import models; models.User` and
`from app.db.models import User` are both permanent, supported import shapes
-- not a temporary shim. New tables get added to their domain module and
re-exported here.
"""

from __future__ import annotations

# ChatMode, ChatRole, ChunkStrategy, DocumentStatus, PipelineIOType, PipelineKind, and
# PipelineRunStatus are imported (not redefined) below so existing `models.ChatRole`
# -style access keeps working -- the enums themselves live in app.schemas.enums
# (db.models imports them, never the reverse).
from app.db.models.api_key import ApiKey
from app.db.models.app_setting import AppSetting
from app.db.models.chat import ChatMessage, ChatSession, ChatSessionCollection
from app.db.models.collection import Collection, CollectionPipelineBinding
from app.db.models.document import Document, DocumentChunkRecord
from app.db.models.evals import (
    EvalDataset,
    EvalDatasetDocument,
    EvalDatasetQuery,
    EvalRelevanceJudgment,
    EvalRun,
    EvalRunItem,
)
from app.db.models.events import IngestionEvent, QueryEvent
from app.db.models.files import FileNode
from app.db.models.index import RegisteredIndex
from app.db.models.model_shortlist import ModelShortlistRow
from app.db.models.pipeline import (
    Pipeline,
    PipelineNodeIO,
    PipelineNodeRun,
    PipelineRun,
    PipelineVersion,
)
from app.db.models.prompt import Prompt, PromptVersion
from app.db.models.provider import ProviderConnection
from app.db.models.telemetry import TelemetryEventRow
from app.db.models.user import AuthSession, TimestampMixin, User
from app.db.models.vectors import VectorIndexRecord
from app.db.models.visualization import (
    InsightClusterRecord,
    InsightDocEdgeRecord,
    InsightDocPointRecord,
    InsightNeighborRecord,
    InsightPointRecord,
    InsightSnapshotRecord,
)
from app.schemas.enums import (
    ApiKeyCapability,
    BindingRole,
    ChatMode,
    ChatRole,
    ChunkStrategy,
    DocumentStatus,
    FileNodeKind,
    InsightSpace,
    InsightStatus,
    PipelineIOType,
    PipelineKind,
    PipelineRunStatus,
)

__all__ = [
    "ApiKey",
    "ApiKeyCapability",
    "AppSetting",
    "AuthSession",
    "BindingRole",
    "ChatMessage",
    "ChatMode",
    "ChatRole",
    "ChatSession",
    "ChatSessionCollection",
    "ChunkStrategy",
    "Collection",
    "CollectionPipelineBinding",
    "Document",
    "DocumentChunkRecord",
    "DocumentStatus",
    "EvalDataset",
    "EvalDatasetDocument",
    "EvalDatasetQuery",
    "EvalRelevanceJudgment",
    "EvalRun",
    "EvalRunItem",
    "FileNode",
    "FileNodeKind",
    "IngestionEvent",
    "InsightClusterRecord",
    "InsightDocEdgeRecord",
    "InsightDocPointRecord",
    "InsightNeighborRecord",
    "InsightPointRecord",
    "InsightSnapshotRecord",
    "InsightSpace",
    "InsightStatus",
    "ModelShortlistRow",
    "Pipeline",
    "PipelineIOType",
    "PipelineKind",
    "PipelineNodeIO",
    "PipelineNodeRun",
    "PipelineRun",
    "PipelineRunStatus",
    "PipelineVersion",
    "Prompt",
    "PromptVersion",
    "ProviderConnection",
    "QueryEvent",
    "RegisteredIndex",
    "TelemetryEventRow",
    "TimestampMixin",
    "User",
    "VectorIndexRecord",
]
