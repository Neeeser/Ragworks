"""Compatibility exports for the chat service module."""

from __future__ import annotations

from app import chat as chat_module

ChatService = chat_module.ChatService
PipelineService = chat_module.PipelineService
RetrievalService = chat_module.RetrievalService
get_openrouter_client = chat_module.get_openrouter_client
get_settings = chat_module.get_settings
render_system_prompt = chat_module.render_system_prompt
resolve_ingestion_settings = chat_module.resolve_ingestion_settings
resolve_retrieval_settings = chat_module.resolve_retrieval_settings
OpenRouterStreamChunk = chat_module.OpenRouterStreamChunk

__all__ = list(chat_module.__all__)
