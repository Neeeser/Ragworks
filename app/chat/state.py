"""State containers for chat request handling."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.chat.messages import ToolCall
from app.chat.usage import UsageSummary
from app.db import models
from app.pipelines.config import IngestionPipelineSettings, RetrievalPipelineSettings
from app.schemas.chat import ChatMessageCreate, ToolCallTrace
from app.schemas.models import ModelInfo


@dataclass(frozen=True)
class PipelineContext:
    """Resolved pipeline settings for ingestion and retrieval."""

    ingestion_settings: IngestionPipelineSettings
    retrieval_settings: RetrievalPipelineSettings


@dataclass(frozen=True)
class ToolCollectionContext:
    """Resolved tool context for a collection."""

    collection: models.Collection
    tool_name: str
    ingestion_settings: IngestionPipelineSettings
    retrieval_settings: RetrievalPipelineSettings


@dataclass(frozen=True)
class ModelSettings:
    """Resolved model settings and supported parameters."""

    active_model_name: str
    model_info: ModelInfo
    supported_parameters: list[str]
    parameter_overrides: dict[str, Any]
    reasoning_options: dict[str, Any]
    provider_preferences: dict[str, Any] | None
    context_window: int


@dataclass(frozen=True)
class ChatSetup:
    """Prepared chat request state before model execution."""

    session_model: models.ChatSession
    messages: list[dict[str, Any]]
    tools: list[dict[str, Any]]
    tool_collections: list[ToolCollectionContext]
    tool_collection_map: dict[str, models.Collection]
    pipeline: PipelineContext | None
    model: ModelSettings


@dataclass
class RunState:
    """Mutable state for a chat request across iterations."""

    tool_traces: list[ToolCallTrace] = field(default_factory=list)
    usage_aggregate: UsageSummary = field(default_factory=UsageSummary)
    latest_usage_payload: dict[str, Any] = field(default_factory=dict)
    provider: str = "openrouter"
    reasoning_trace: list[dict[str, Any]] = field(default_factory=list)
    processed_reasoning_calls: set[str] = field(default_factory=set)
    reasoning_call_segments: dict[str, dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolCallResolution:
    """Resolved tool calls for an iteration, typed as `ToolCall` models."""

    pending_tool_calls: list[ToolCall]
    shared_tool_reasoning: dict[str, Any] | None


@dataclass(frozen=True)
class StreamToolCallContext:
    """Context for resolving streaming tool calls."""

    message: dict[str, Any]
    setup: ChatSetup
    run_state: RunState
    user: models.User
    payload: ChatMessageCreate


@dataclass(frozen=True)
class ToolExecutionContext:
    """Execution context for running tool calls."""

    user: models.User
    payload: ChatMessageCreate
    session_model: models.ChatSession
    messages: list[dict[str, Any]]
    run_state: RunState
    shared_tool_reasoning: dict[str, Any] | None
    tool_collection_map: dict[str, models.Collection]


@dataclass(frozen=True)
class ProviderResponse:
    """Parsed provider response for an iteration."""

    message: dict[str, Any]
    usage: dict[str, Any]
    response_model_name: str | None


@dataclass(frozen=True)
class StreamIterationResult:
    """Streamed provider result including metadata.

    `finish_reason` is carried through so it's no longer silently dropped by
    the data structure (it used to be index 3 of a 5-tuple that only ever
    unpacked indices 0, 1, 2, 4). Whether `ChatService` acts on it is a
    separate concern.
    """

    message: dict[str, Any]
    usage: dict[str, Any]
    provider_name: str
    response_model_name: str | None
    finish_reason: str | None = None
