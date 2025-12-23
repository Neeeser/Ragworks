from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.db import models
from app.pipelines.config import IngestionPipelineSettings, RetrievalPipelineSettings
from app.services import prompts
from app.services.prompts import (
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  SYSTEM_PROMPT_METADATA_KEY,
  _stringify,
  apply_prompt_template,
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
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_get_system_prompt_template_falls_back_to_default():
    collection = _build_collection(extra_metadata={SYSTEM_PROMPT_METADATA_KEY: "   "})
    template = get_system_prompt_template(collection)
    assert template == DEFAULT_SYSTEM_PROMPT_TEMPLATE


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
        metric="cosine",
        chat_model="chat-model",
        context_window=8192,
    )
    context = system_prompt_context(
        collection,
        user,
        ingestion_settings=ingestion_settings,
        retrieval_settings=retrieval_settings,
    )

    assert context["collection.name"] == "Demo Collection"
    assert context["collection.description"] == "N/A"
    assert context["collection.chunk.strategy"] == models.ChunkStrategy.PARAGRAPH.value
    assert context["metadata.embedding_dimension"] == "2048"
    assert context["metadata.region"] == "us-west"
    assert context["user.full_name"] == "user@example.com"  # falls back to email


def test_render_system_prompt_uses_custom_template(monkeypatch):
    fixed_now = datetime(2024, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    monkeypatch.setattr(prompts, "utc_now", lambda: fixed_now)

    template = "Hello {{collection.name}} by {{user.email}} at {{datetime.iso}}"
    collection = _build_collection(extra_metadata={SYSTEM_PROMPT_METADATA_KEY: template})
    user = _build_user(email="custom@example.com")

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
        metric="cosine",
        chat_model="chat-model",
        context_window=8192,
    )

    rendered = render_system_prompt(
        collection,
        user,
        ingestion_settings=ingestion_settings,
        retrieval_settings=retrieval_settings,
    )
    assert rendered == "Hello Demo Collection by custom@example.com at 2024-01-02T03:04:05+00:00"


def test_prompt_variables_payload_exposes_expected_names():
    names = {item["name"] for item in prompt_variables_payload()}
    assert "collection.name" in names
    assert "datetime.iso" in names
    assert "user.email" in names


def test_stringify_returns_default_on_unserializable_value() -> None:
    payload = {("tuple",): "value"}

    assert _stringify(payload) == "N/A"


def test_stringify_handles_boolean_values() -> None:
    assert _stringify(True) == "true"
    assert _stringify(False) == "false"
