"""Behavior of the prompt-rendering package (templates/context/render)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.db import models
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.settings import IngestionPipelineSettings, RetrievalPipelineSettings
from app.schemas.enums import IndexBackend
from app.services.prompts import (
    DEFAULT_BASE_PROMPT_TEMPLATE,
    DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    SYSTEM_PROMPT_METADATA_KEY,
    PromptContext,
    apply_prompt_template,
    base_prompt_context,
    collection_tool_name,
    get_base_prompt_template,
    get_system_prompt_template,
    prompt_variables_payload,
    render_system_prompt,
    system_prompt_context,
    with_system_prompt_template,
)
from app.services.prompts import context as prompts_context
from app.services.prompts.context import _chunk_strategy_label, _stringify


def _build_collection(**overrides: Any) -> models.Collection:
    defaults: dict[str, Any] = {
        "user_id": uuid4(),
        "name": "Demo Collection",
        "description": "Demo description",
        "extra_metadata": {"embedding_dimension": 1536},
    }
    defaults.update(overrides)
    return models.Collection(**defaults)


def _build_user(**overrides: Any) -> models.User:
    defaults: dict[str, Any] = {
        "email": "user@example.com",
        "full_name": "Example User",
        "hashed_password": "hashed",
        "system_prompt_template": None,
    }
    defaults.update(overrides)
    return models.User(**defaults)


def _ingestion_settings(**overrides: Any) -> IngestionPipelineSettings:
    defaults: dict[str, Any] = {
        "chunk_strategy": models.ChunkStrategy.TOKEN,
        "chunk_size": 1024,
        "chunk_overlap": 200,
        "tokenizer": TokenizerSpec(kind="wordpiece"),
        "embedding_model": "text-embed",
        "backend": IndexBackend.PINECONE,
        "index_name": "pinecone-index",
        "namespace": "pinecone-namespace",
        "dimension": 1536,
        "metric": "cosine",
    }
    defaults.update(overrides)
    return IngestionPipelineSettings(**defaults)


def _retrieval_settings(**overrides: Any) -> RetrievalPipelineSettings:
    defaults: dict[str, Any] = {
        "embedding_model": "text-embed",
        "backend": IndexBackend.PINECONE,
        "index_name": "pinecone-index",
        "namespace": "pinecone-namespace",
        "dimension": 1536,
    }
    defaults.update(overrides)
    return RetrievalPipelineSettings(**defaults)


def test_get_system_prompt_template_falls_back_to_default() -> None:
    collection = _build_collection(extra_metadata={SYSTEM_PROMPT_METADATA_KEY: "   "})
    template = get_system_prompt_template(collection)
    assert template == DEFAULT_SYSTEM_PROMPT_TEMPLATE


def test_get_base_prompt_template_falls_back_to_default() -> None:
    user = _build_user(system_prompt_template="  ")
    template = get_base_prompt_template(user)
    assert template == DEFAULT_BASE_PROMPT_TEMPLATE


def test_apply_prompt_template_replaces_known_placeholders() -> None:
    context = {"foo.bar": "value", "user.email": "user@example.com"}
    template = "Value {{ foo.bar }} :: {{ user.email }} :: {{missing}}"
    rendered = apply_prompt_template(template, context)
    assert rendered == "Value value :: user@example.com :: {{missing}}"


def test_system_prompt_context_includes_collection_and_metadata() -> None:
    collection = _build_collection(
        extra_metadata={"embedding_dimension": 2048, "region": "us-west"},
        description=None,
    )
    user = _build_user(full_name=None)
    ingestion_settings = _ingestion_settings(
        chunk_strategy=models.ChunkStrategy.PARAGRAPH, dimension=2048
    )
    retrieval_settings = _retrieval_settings(dimension=2048)

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


def test_system_prompt_context_extends_base_context_without_duplicating(monkeypatch) -> None:
    """`system_prompt_context` must call `base_prompt_context`, not re-derive its
    user/datetime keys -- the two contexts should agree exactly on those keys."""
    fixed_now = datetime(2024, 1, 2, 3, 4, 5, tzinfo=UTC)
    monkeypatch.setattr(prompts_context, "utc_now", lambda: fixed_now)

    collection = _build_collection()
    user = _build_user()

    base = base_prompt_context(user)
    system = system_prompt_context(collection, user)

    for key, value in base.items():
        assert system[key] == value


def test_chunk_strategy_label_reads_enum_value() -> None:
    settings = _ingestion_settings(chunk_strategy=models.ChunkStrategy.SEMANTIC)
    assert _chunk_strategy_label(settings) == "semantic"


def test_chunk_strategy_label_none_without_ingestion_settings() -> None:
    assert _chunk_strategy_label(None) is None


def test_render_system_prompt_uses_custom_template(monkeypatch) -> None:
    fixed_now = datetime(2024, 1, 2, 3, 4, 5, tzinfo=UTC)
    monkeypatch.setattr(prompts_context, "utc_now", lambda: fixed_now)

    base_template = "Base {{user.email}} at {{datetime.iso}}"
    tool_template = "Tool {{collection.name}} via {{collection.tool_name}}"
    collection = _build_collection(extra_metadata={SYSTEM_PROMPT_METADATA_KEY: tool_template})
    user = _build_user(email="custom@example.com", system_prompt_template=base_template)

    ingestion_settings = _ingestion_settings()
    retrieval_settings = _retrieval_settings()

    context = system_prompt_context(
        collection,
        user,
        ingestion_settings=ingestion_settings,
        retrieval_settings=retrieval_settings,
        tool_name=collection_tool_name(collection.name),
    )
    rendered = render_system_prompt(
        [PromptContext(template=tool_template, context=context)],
        user,
    )
    assert "Base custom@example.com at 2024-01-02T03:04:05+00:00" in rendered
    assert f"Tool Demo Collection via {collection_tool_name(collection.name)}" in rendered


def test_default_system_prompt_without_collections_is_tool_agnostic() -> None:
    user = _build_user()

    rendered = render_system_prompt([], user)

    assert "tool" not in rendered.casefold()


def test_prompt_variables_payload_exposes_expected_names() -> None:
    base_names = {variable.name for variable in prompt_variables_payload(scope="base")}
    assert "user.email" in base_names
    assert "datetime.iso" in base_names
    assert "collection.name" not in base_names

    collection_names = {variable.name for variable in prompt_variables_payload(scope="collection")}
    assert "collection.name" in collection_names
    assert "collection.tool_name" in collection_names
    assert "user.email" in collection_names


def test_base_prompt_context_includes_user_profile(monkeypatch) -> None:
    fixed_now = datetime(2024, 1, 2, 3, 4, 5, tzinfo=UTC)
    monkeypatch.setattr(prompts_context, "utc_now", lambda: fixed_now)

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


def test_with_system_prompt_template_sets_without_mutating_input() -> None:
    original = {"other": "kept"}

    result = with_system_prompt_template(original, "Hello")

    assert result == {"other": "kept", SYSTEM_PROMPT_METADATA_KEY: "Hello"}
    assert result is not original
    assert original == {"other": "kept"}  # never mutated: JSON columns need new dicts


def test_with_system_prompt_template_clears_on_blank_without_mutating_input() -> None:
    original = {"other": "kept", SYSTEM_PROMPT_METADATA_KEY: "old"}

    result = with_system_prompt_template(original, "   ")

    assert result == {"other": "kept"}
    assert result is not original
    assert original[SYSTEM_PROMPT_METADATA_KEY] == "old"
