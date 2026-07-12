"""Domain enums shared by the wire contract (`app/schemas/`) and persistence
(`app/db/models/`).

These live in `app/schemas` — not `app/db` — because the wire contract must not
transitively depend on SQLModel: `db.models` imports these enums, never the
reverse.
"""

from __future__ import annotations

from enum import Enum


class ChunkStrategy(str, Enum):
    """Chunking strategies for documents."""

    TOKEN = "token"
    SENTENCE = "sentence"
    PARAGRAPH = "paragraph"
    SEMANTIC = "semantic"


class FileNodeKind(str, Enum):
    """Node kinds in a collection's file tree."""

    FOLDER = "folder"
    FILE = "file"


class DocumentStatus(str, Enum):
    """Status values for document processing."""

    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class ChatMode(str, Enum):
    """Chat mode selections."""

    QUERY = "query"
    CHAT = "chat"


class ChatRole(str, Enum):
    """Roles assigned to chat messages."""

    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class PipelineKind(str, Enum):
    """Pipeline categories for ingestion and retrieval."""

    INGESTION = "ingestion"
    RETRIEVAL = "retrieval"


class PipelineRunStatus(str, Enum):
    """Execution status values for pipeline runs."""

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PipelineIOType(str, Enum):
    """Direction of pipeline node input/output payloads."""

    INPUT = "input"
    OUTPUT = "output"


class IndexBackend(str, Enum):
    """Vector-store backends a pipeline can index into and query from."""

    PINECONE = "pinecone"
    PGVECTOR = "pgvector"


class UserRole(str, Enum):
    """Privilege tiers for user accounts."""

    ADMIN = "admin"
    USER = "user"


class StatsHistoryRange(str, Enum):
    """Trailing window for collection activity history (bucketed hour/day)."""

    HOURS_4 = "4h"
    HOURS_24 = "24h"
    DAYS_7 = "7d"
    DAYS_30 = "30d"
