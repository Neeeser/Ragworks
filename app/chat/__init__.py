"""Chat service package exports."""

from __future__ import annotations

from app.chat.service import ChatService
from app.clients.openrouter import get_openrouter_client
from app.core.config import get_settings
from app.pipelines.config import resolve_ingestion_settings, resolve_retrieval_settings
from app.schemas.openrouter import OpenRouterStreamChunk
from app.services.pipelines import PipelineService
from app.services.prompts import render_system_prompt
from app.services.retrieval import RetrievalService

__all__ = [
    "ChatService",
    "OpenRouterStreamChunk",
    "PipelineService",
    "RetrievalService",
    "get_openrouter_client",
    "get_settings",
    "render_system_prompt",
    "resolve_ingestion_settings",
    "resolve_retrieval_settings",
]
