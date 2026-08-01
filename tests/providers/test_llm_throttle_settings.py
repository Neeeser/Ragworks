"""Connection-level LLM throttle settings read through the adapters."""

from __future__ import annotations

from uuid import uuid4

from app.db.models import ProviderConnection
from app.providers.anthropic import AnthropicAdapter
from app.providers.ollama import OllamaAdapter
from app.providers.openai import OpenAIAdapter


def _connection(provider_type: str, config: dict[str, object]) -> ProviderConnection:
    return ProviderConnection(
        user_id=uuid4(), provider_type=provider_type, label="t", config=config
    )


def test_defaults_follow_the_provider_starter_tiers() -> None:
    openai = OpenAIAdapter(_connection("openai", {"api_key": "sk-x"}))
    assert openai.llm_concurrency() == 8
    assert openai.llm_requests_per_minute() == 500

    anthropic = AnthropicAdapter(_connection("anthropic", {"api_key": "sk-ant-x"}))
    assert anthropic.llm_concurrency() == 4
    assert anthropic.llm_requests_per_minute() == 50

    ollama = OllamaAdapter(_connection("ollama", {"base_url": "http://localhost:11434"}))
    assert ollama.llm_concurrency() == 1
    assert ollama.llm_requests_per_minute() is None  # local server: unpaced


def test_stored_overrides_win() -> None:
    adapter = OpenAIAdapter(
        _connection(
            "openai",
            {"api_key": "sk-x", "max_concurrent_requests": "12", "requests_per_minute": "40"},
        )
    )
    assert adapter.llm_concurrency() == 12
    assert adapter.llm_requests_per_minute() == 40
