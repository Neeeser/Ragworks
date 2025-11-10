from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, String, Text
from sqlmodel import Field, SQLModel


class TimestampMixin:
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


class ChunkStrategy(str, Enum):
    TOKEN = "token"
    SENTENCE = "sentence"
    PARAGRAPH = "paragraph"
    SEMANTIC = "semantic"


class DocumentStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


class ChatMode(str, Enum):
    QUERY = "query"
    CHAT = "chat"


class ChatRole(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class User(SQLModel, TimestampMixin, table=True):
    __tablename__ = "users"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    email: str = Field(sa_column=Column(String, unique=True, index=True, nullable=False))
    full_name: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    hashed_password: str = Field(sa_column=Column(String, nullable=False))
    is_active: bool = Field(default=True, nullable=False)


class Collection(SQLModel, TimestampMixin, table=True):
    __tablename__ = "collections"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    description: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    embedding_model: str = Field(sa_column=Column(String, nullable=False))
    chat_model: str = Field(sa_column=Column(String, nullable=False))
    context_window: int = Field(default=8192, nullable=False)
    chunk_size: int = Field(default=1024, nullable=False)
    chunk_overlap: int = Field(default=200, nullable=False)
    chunk_strategy: ChunkStrategy = Field(
        default=ChunkStrategy.TOKEN,
        sa_column=Column(String, nullable=False),
    )
    pinecone_index: str = Field(sa_column=Column(String, nullable=False))
    pinecone_namespace: str = Field(sa_column=Column(String, nullable=False))
    extra_metadata: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata", JSON, nullable=False),
    )


class Document(SQLModel, TimestampMixin, table=True):
    __tablename__ = "documents"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    content_type: str = Field(sa_column=Column(String, nullable=False))
    source_path: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    status: DocumentStatus = Field(
        default=DocumentStatus.PENDING,
        sa_column=Column(String, nullable=False),
    )
    num_chunks: int = Field(default=0, nullable=False)
    num_tokens: int = Field(default=0, nullable=False)
    chunk_size: int = Field(default=1024, nullable=False)
    chunk_overlap: int = Field(default=200, nullable=False)
    chunk_strategy: ChunkStrategy = Field(
        default=ChunkStrategy.TOKEN,
        sa_column=Column(String, nullable=False),
    )
    embedding_model: str = Field(sa_column=Column(String, nullable=False))


class DocumentChunkRecord(SQLModel, TimestampMixin, table=True):
    __tablename__ = "document_chunks"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    chunk_index: int = Field(nullable=False, index=True)
    text: str = Field(sa_column=Column(Text, nullable=False))
    embedding: list[float] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    chunk_metadata: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("metadata", JSON, nullable=False),
    )
    score: Optional[float] = Field(default=None, nullable=True)
    chunk_size: int = Field(default=0, nullable=False)
    chunk_overlap: int = Field(default=0, nullable=False)
    chunk_strategy: ChunkStrategy = Field(
        default=ChunkStrategy.TOKEN,
        sa_column=Column(String, nullable=False),
    )
    embedding_model: str = Field(sa_column=Column(String, nullable=False))


class IngestionEvent(SQLModel, TimestampMixin, table=True):
    __tablename__ = "ingestion_events"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    document_id: UUID = Field(foreign_key="documents.id", nullable=False, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    event_type: str = Field(sa_column=Column(String, nullable=False))
    status: str = Field(sa_column=Column(String, nullable=False))
    details: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class ChatSession(SQLModel, TimestampMixin, table=True):
    __tablename__ = "chat_sessions"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    title: str = Field(sa_column=Column(String, nullable=False))
    mode: ChatMode = Field(default=ChatMode.CHAT, sa_column=Column(String, nullable=False))
    chat_model: str = Field(sa_column=Column(String, nullable=False))
    context_tokens: int = Field(default=0, nullable=False)


class ChatMessage(SQLModel, TimestampMixin, table=True):
    __tablename__ = "chat_messages"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    session_id: UUID = Field(foreign_key="chat_sessions.id", nullable=False, index=True)
    role: ChatRole = Field(sa_column=Column(String, nullable=False))
    content: str = Field(sa_column=Column(Text, nullable=False))
    model: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    tool_name: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    tool_call_id: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    tool_payload: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    reasoning_trace: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    prompt_tokens: Optional[int] = Field(default=None, nullable=True)
    completion_tokens: Optional[int] = Field(default=None, nullable=True)
    usage: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )


class QueryEvent(SQLModel, TimestampMixin, table=True):
    __tablename__ = "query_events"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    collection_id: UUID = Field(foreign_key="collections.id", nullable=False, index=True)
    query_text: str = Field(sa_column=Column(Text, nullable=False))
    top_k: int = Field(default=5, nullable=False)
    model: str = Field(sa_column=Column(String, nullable=False))
    context_tokens: int = Field(default=0, nullable=False)
    response_payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
