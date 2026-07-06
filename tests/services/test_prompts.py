from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db import models
from app.pipelines.config import IngestionPipelineSettings, RetrievalPipelineSettings
from app.services import prompts
from app.services.prompts import (
  DEFAULT_BASE_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  SYSTEM_PROMPT_METADATA_KEY,
  _stringify,
  apply_prompt_template,
  base_prompt_context,
  collection_tool_name,
  get_base_prompt_template,
  get_system_prompt_template,
  prompt_variables_payload,
  render_system_prompt,
  system_prompt_context,
)


def _build_collection(**overrides):
    defaults = {
        "id": uuid4(),
        "user_id": uuid4(),
        "name": "Demo Collection",
        "description": "Demo description",
        "extra_metadata": {"embedding_dimension": 1536},
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _build_user(**overrides):
    defaults = {
        "id": uuid4(),
        "email": "user@example.com",
        "full_name": "Example User",
        "system_prompt_template": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_get_system_prompt_template_falls_back_to_default():
    collection = _build_collection(extra_metadata={SYSTEM_PROMPT_METADATA_KEY: "   "})
    template = get_system_prompt_template(collection)
    assert template == DEFAULT_SYSTEM_PROMPT_TEMPLATE


def test_get_base_prompt_template_falls_back_to_default():
    user = _build_user(system_prompt_template="  ")
    template = get_base_prompt_template(user)
    assert template == DEFAULT_BASE_PROMPT_TEMPLATE


def test_apply_prompt_template_replaces_known_placeholders():
    context = {"foo.bar": "value", "user.email": "user@example.com"}
    template = "Value {{ foo.bar }} :: {{ user.email }} :: {{missing}}"
    rendered = apply_prompt_template(template, context)
    assert rendered == "Value value :: user@example.com :: {{missing}}"


def test_system_prompt_context_includes_collection_and_metadata():
    collection = _build_collection(
        extra_metadata={"embedding_dimension": 2048, "region": "us-west"},
        description=None,
    )
    user = _build_user(full_name=None)
    ingestion_settings = IngestionPipelineSettings(
        chunk_strategy=models.ChunkStrategy.PARAGRAPH,
        chunk_size=1024,
        chunk_overlap=200,
        embedding_model="text-embed",
        index_name="pinecone-index",
        namespace="pinecone-namespace",
        dimension=2048,
        metric="cosine",
    )
    retrieval_settings = RetrievalPipelineSettings(
        embedding_model="text-embed",
        index_name="pinecone-index",
        namespace="pinecone-namespace",
        dimension=2048,
        chat_model="chat-model",
        context_window=8192,
    )
    context = system_prompt_context(
        collection,
        user,
        ingestion_settings=ingestion_settings,
        retrieval_settings=retrieval_settings,
        tool_name="custom_tool",
    )

    assert context["collection.name"] == "Demo Collection"
    assert context["collection.description"] == "N/A"
    assert context["collection.tool_name"] == "custom_tool"
    assert context["collection.chunk.strategy"] == models.ChunkStrategy.PARAGRAPH.value
    assert context["metadata.embedding_dimension"] == "2048"
    assert context["metadata.region"] == "us-west"
    assert context["user.full_name"] == "user@example.com"  # falls back to email


def test_render_system_prompt_uses_custom_template(monkeypatch):
    fixed_now = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    monkeypatch.setattr(prompts, "utc_now", lambda: fixed_now)

    base_template = "Base {{user.email}} at {{datetime.iso}}"
    tool_template = "Tool {{collection.name}} via {{collection.tool_name}}"
    collection = _build_collection(extra_metadata={SYSTEM_PROMPT_METADATA_KEY: tool_template})
    user = _build_user(email="custom@example.com")
    user.system_prompt_template = base_template

    ingestion_settings = IngestionPipelineSettings(
        chunk_strategy=models.ChunkStrategy.TOKEN,
        chunk_size=1024,
        chunk_overlap=200,
        embedding_model="text-embed",
        index_name="pinecone-index",
        namespace="pinecone-namespace",
        dimension=1536,
        metric="cosine",
    )
    retrieval_settings = RetrievalPipelineSettings(
        embedding_model="text-embed",
        index_name="pinecone-index",
        namespace="pinecone-namespace",
        dimension=1536,
        chat_model="chat-model",
        context_window=8192,
    )

    context = system_prompt_context(
        collection,
        user,
        ingestion_settings=ingestion_settings,
        retrieval_settings=retrieval_settings,
        tool_name=collection_tool_name(collection.id),
    )
    rendered = render_system_prompt(
        [{"template": tool_template, "context": context}],
        user,
    )
    assert "Base custom@example.com at 2024-01-02T03:04:05+00:00" in rendered
    assert f"Tool Demo Collection via {collection_tool_name(collection.id)}" in rendered


def test_prompt_variables_payload_exposes_expected_names():
    base_names = {item["name"] for item in prompt_variables_payload(scope="base")}
    assert "user.email" in base_names
    assert "datetime.iso" in base_names
    assert "collection.name" not in base_names

    collection_names = {item["name"] for item in prompt_variables_payload(scope="collection")}
    assert "collection.name" in collection_names
    assert "collection.tool_name" in collection_names
    assert "user.email" in collection_names


def test_base_prompt_context_includes_user_profile(monkeypatch):
    fixed_now = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    monkeypatch.setattr(prompts, "utc_now", lambda: fixed_now)

    user = _build_user(full_name=None, email="viewer@example.com")
    context = base_prompt_context(user)

    assert context["user.full_name"] == "viewer@example.com"
    assert context["datetime.iso"] == "2024-01-02T03:04:05+00:00"


def test_stringify_returns_default_on_unserializable_value() -> None:
    payload = {("tuple",): "value"}

    assert _stringify(payload) == "N/A"


def test_stringify_handles_boolean_values() -> None:
    assert _stringify(True) == "true"
    assert _stringify(False) == "false"
