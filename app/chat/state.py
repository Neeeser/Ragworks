"""State containers for chat request handling."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

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
class ModelSettings:
    """Resolved model settings and supported parameters."""

    active_model_name: str
    model_info: ModelInfo
    supported_parameters: List[str]
    parameter_overrides: Dict[str, Any]
    reasoning_options: Dict[str, Any]
    provider_preferences: Optional[Dict[str, Any]]
    context_window: int


@dataclass(frozen=True)
class ChatSetup:
    """Prepared chat request state before model execution."""

    session_model: models.ChatSession
    messages: List[Dict[str, Any]]
    tools: List[Dict[str, Any]]
    pipeline: PipelineContext
    model: ModelSettings


@dataclass
class RunState:
    """Mutable state for a chat request across iterations."""

    tool_traces: List[ToolCallTrace] = field(default_factory=list)
    usage_aggregate: Dict[str, float] = field(default_factory=dict)
    latest_usage_payload: Dict[str, Any] = field(default_factory=dict)
    provider: str = "openrouter"
    reasoning_trace: List[Dict[str, Any]] = field(default_factory=list)
    processed_reasoning_calls: Set[str] = field(default_factory=set)
    reasoning_call_segments: Dict[str, Dict[str, Any]] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolCallResolution:
    """Resolved tool call payloads for an iteration."""

    pending_tool_calls: List[Dict[str, Any]]
    shared_tool_reasoning: Optional[Dict[str, Any]]


@dataclass(frozen=True)
class StreamToolCallContext:
    """Context for resolving streaming tool calls."""

    message: Dict[str, Any]
    setup: ChatSetup
    run_state: RunState
    user: models.User
    collection: models.Collection
    payload: ChatMessageCreate


@dataclass(frozen=True)
class ToolExecutionContext:
    """Execution context for running tool calls."""

    user: models.User
    collection: models.Collection
    payload: ChatMessageCreate
    session_model: models.ChatSession
    messages: List[Dict[str, Any]]
    run_state: RunState
    shared_tool_reasoning: Optional[Dict[str, Any]]


@dataclass(frozen=True)
class ProviderResponse:
    """Parsed provider response for an iteration."""

    message: Dict[str, Any]
    usage: Dict[str, Any]
    response_model_name: Optional[str]


@dataclass(frozen=True)
class StreamIterationResult:
    """Streamed provider result including metadata."""

    message: Dict[str, Any]
    usage: Dict[str, Any]
    provider_name: str
    response_model_name: Optional[str]
