"""Connection-level LLM throttle settings read through the adapters."""

from __future__ import annotations

from uuid import uuid4

from app.db.models import ProviderConnection
from app.providers.anthropic import AnthropicAdapter
from app.providers.cohere import CohereAdapter
from app.providers.ollama import OllamaAdapter
from app.providers.openai import OpenAIAdapter
from app.schemas.enums import ProviderKind


def _connection(provider_type: str, config: dict[str, object]) -> ProviderConnection:
    return ProviderConnection(
        user_id=uuid4(), provider_type=provider_type, label="t", config=config
    )


def test_defaults_follow_the_provider_starter_tiers() -> None:
    openai = OpenAIAdapter(_connection("openai", {"api_key": "sk-x"}))
    assert openai.request_concurrency() == 8
    assert openai.request_rpm() == 500

    anthropic = AnthropicAdapter(_connection("anthropic", {"api_key": "sk-ant-x"}))
    assert anthropic.request_concurrency() == 4
    assert anthropic.request_rpm() == 50

    ollama = OllamaAdapter(_connection("ollama", {"base_url": "http://localhost:11434"}))
    assert ollama.request_concurrency() == 1
    assert ollama.request_rpm() is None  # local server: unpaced


def test_stored_overrides_win() -> None:
    adapter = OpenAIAdapter(
        _connection(
            "openai",
            {"api_key": "sk-x", "max_concurrent_requests": "12", "requests_per_minute": "40"},
        )
    )
    assert adapter.request_concurrency() == 12
    assert adapter.request_rpm() == 40


def test_per_kind_pace_carves_out_only_where_a_pace_exists() -> None:
    openai = OpenAIAdapter(_connection("openai", {"api_key": "sk-x"}))
    # Embeddings ship their own default pace, so they get their own window.
    assert openai.request_pace(ProviderKind.EMBEDDING) == (3000, "embedding")
    # Chat draws from the shared window at the shared pace.
    assert openai.request_pace(ProviderKind.CHAT) == (500, "shared")

    cohere = CohereAdapter(_connection("cohere", {"api_key": "co-x"}))
    assert cohere.request_pace(ProviderKind.RERANKING) == (1000, "reranking")

    # No per-kind pace anywhere: everything shares one (unpaced) window.
    ollama = OllamaAdapter(_connection("ollama", {"base_url": "http://localhost:11434"}))
    assert ollama.request_pace(ProviderKind.EMBEDDING) == (None, "shared")


def test_per_kind_override_wins_over_the_kind_default() -> None:
    adapter = OpenAIAdapter(
        _connection(
            "openai", {"api_key": "sk-x", "embedding_requests_per_minute": "6000"}
        )
    )
    assert adapter.request_pace(ProviderKind.EMBEDDING) == (6000, "embedding")
