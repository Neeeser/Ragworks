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
# (db.models imports them, never the reverse; see app/AGENTS.md).
from app.db.models.app_setting import AppSetting
from app.db.models.chat import ChatMessage, ChatSession, ChatSessionCollection
from app.db.models.collection import Collection
from app.db.models.document import Document, DocumentChunkRecord
from app.db.models.events import IngestionEvent, QueryEvent
from app.db.models.files import FileNode
from app.db.models.pipeline import (
    Pipeline,
    PipelineNodeIO,
    PipelineNodeRun,
    PipelineRun,
    PipelineVersion,
)
from app.db.models.telemetry import TelemetryEventRow
from app.db.models.user import TimestampMixin, User
from app.db.models.vectors import VectorIndexRecord
from app.db.models.visualization import UmapPointRecord, UmapProjectionRecord
from app.schemas.enums import (
    ChatMode,
    ChatRole,
    ChunkStrategy,
    DocumentStatus,
    FileNodeKind,
    PipelineIOType,
    PipelineKind,
    PipelineRunStatus,
)

__all__ = [
    "AppSetting",
    "ChatMessage",
    "ChatMode",
    "ChatRole",
    "ChatSession",
    "ChatSessionCollection",
    "ChunkStrategy",
    "Collection",
    "Document",
    "DocumentChunkRecord",
    "DocumentStatus",
    "FileNode",
    "FileNodeKind",
    "IngestionEvent",
    "Pipeline",
    "PipelineIOType",
    "PipelineKind",
    "PipelineNodeIO",
    "PipelineNodeRun",
    "PipelineRun",
    "PipelineRunStatus",
    "PipelineVersion",
    "QueryEvent",
    "TelemetryEventRow",
    "TimestampMixin",
    "UmapPointRecord",
    "UmapProjectionRecord",
    "User",
    "VectorIndexRecord",
]
