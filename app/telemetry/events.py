"""The telemetry event taxonomy: one typed model per recordable fact.

Adding an event: define a model here with a unique ``type`` literal, add it
to the ``TelemetryEvent`` union, and call ``record(...)`` at the service-layer
site where the fact becomes true (see app/AGENTS.md, "Hooking into
telemetry"). Events are lightweight aggregatable facts — heavyweight
operational records that power features (trace payloads) stay domain tables.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class _BaseEvent(BaseModel):
    """Common shape: every event may carry the acting user."""

    user_id: UUID | None = None


class ChatTurnCompleted(_BaseEvent):
    """An assistant turn finished (streaming or not — one shared write site)."""

    type: Literal["chat.turn_completed"] = "chat.turn_completed"
    session_id: UUID
    model: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    cost: float | None = None


class DocumentIngested(_BaseEvent):
    """A document upload finished ingestion (successfully or not)."""

    type: Literal["document.ingested"] = "document.ingested"
    collection_id: UUID
    document_id: UUID
    status: str
    chunk_count: int | None = None
    size_bytes: int | None = None
    index_backend: str | None = None


class RetrievalQueryRan(_BaseEvent):
    """A retrieval query executed against a collection."""

    type: Literal["retrieval.query_ran"] = "retrieval.query_ran"
    collection_id: UUID
    latency_ms: float | None = None
    top_k: int | None = None
    index_backend: str | None = None


class UserRegistered(_BaseEvent):
    """A new account was created."""

    type: Literal["user.registered"] = "user.registered"


class UserSignedIn(_BaseEvent):
    """A user exchanged credentials for an access token."""

    type: Literal["user.signed_in"] = "user.signed_in"


class IndexCreated(_BaseEvent):
    """A vector index was created through the index admin API."""

    type: Literal["index.created"] = "index.created"
    backend: str
    index_name: str
    dimension: int | None = None
    metric: str | None = None


class IndexDeleted(_BaseEvent):
    """A vector index was deleted through the index admin API."""

    type: Literal["index.deleted"] = "index.deleted"
    backend: str
    index_name: str


class CollectionCreated(_BaseEvent):
    """A collection was created."""

    type: Literal["collection.created"] = "collection.created"
    collection_id: UUID


class CollectionDeleted(_BaseEvent):
    """A collection (and its stores) was deleted."""

    type: Literal["collection.deleted"] = "collection.deleted"
    collection_id: UUID


TelemetryEvent = Annotated[
    ChatTurnCompleted
    | DocumentIngested
    | RetrievalQueryRan
    | UserRegistered
    | UserSignedIn
    | IndexCreated
    | IndexDeleted
    | CollectionCreated
    | CollectionDeleted,
    Field(discriminator="type"),
]
