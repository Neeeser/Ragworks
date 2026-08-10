"""Input modalities are derived from what a provider actually publishes.

A modality badge is a claim the model accepts that input, and the picker shows
it as a capability the user can rely on. These pin the derivations that read a
provider's own positive statement -- Ollama's `/api/show` capability list,
Anthropic's published capability tree, and OpenRouter's `architecture` block --
so a vision model never renders as text-only, and a text-only model never
claims vision.
"""

from __future__ import annotations

from typing import TypeVar
from uuid import uuid4

import pytest

from app.cache import CacheSnapshot
from app.db import models
from app.providers.anthropic import AnthropicAdapter
from app.providers.ollama import OllamaAdapter
from app.providers.openrouter import OpenRouterAdapter
from app.schemas.anthropic import AnthropicModel
from app.schemas.enums import ProviderKind
from app.schemas.models import ModelInfo
from app.schemas.ollama import OllamaModelDescription

ValueT = TypeVar("ValueT")


def _snapshot(value: ValueT) -> CacheSnapshot[ValueT]:
    return CacheSnapshot(
        value=value,
        freshness="fresh",
        age_seconds=0,
        refreshing=False,
        warning=None,
    )


def _ollama_adapter() -> OllamaAdapter:
    return OllamaAdapter(
        models.ProviderConnection(
            user_id=uuid4(),
            provider_type="ollama",
            label="Ollama",
            config={"base_url": "http://ollama.test:11434"},
        )
    )


def _anthropic_adapter() -> AnthropicAdapter:
    return AnthropicAdapter(
        models.ProviderConnection(
            user_id=uuid4(),
            provider_type="anthropic",
            label="Anthropic",
            config={"api_key": "sk-ant-test"},
        )
    )


def test_ollama_vision_capability_becomes_an_image_input_modality(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = _ollama_adapter()

    class _Client:
        @staticmethod
        def describe_models(force_refresh: bool = False):
            return _snapshot(
                [
                    OllamaModelDescription(
                        name="llava:13b",
                        capabilities=["completion", "vision"],
                        context_length=32_000,
                    ),
                    OllamaModelDescription(
                        name="qwen3:32b",
                        capabilities=["completion", "tools"],
                        context_length=40_000,
                    ),
                ]
            )

    monkeypatch.setattr(adapter, "_client", lambda: _Client())

    catalog = {model.id: model for model in adapter.list_models(ProviderKind.CHAT).models}

    assert catalog["llava:13b"].input_modalities == ["text", "image"]
    assert catalog["qwen3:32b"].input_modalities == ["text"]
    assert catalog["llava:13b"].output_modalities == ["text"]


def test_ollama_embedding_models_stay_text_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = _ollama_adapter()

    class _Client:
        @staticmethod
        def describe_models(force_refresh: bool = False):
            return _snapshot(
                [
                    OllamaModelDescription(
                        name="nomic-embed-text:latest",
                        # A server that advertises vision on an embedding model
                        # still only takes text through the embed endpoint.
                        capabilities=["embedding", "vision"],
                        embedding_dimension=768,
                    )
                ]
            )

    monkeypatch.setattr(adapter, "_client", lambda: _Client())

    entries = adapter.list_models(ProviderKind.EMBEDDING).models

    assert [entry.input_modalities for entry in entries] == [["text"]]


def test_anthropic_image_input_capability_becomes_an_image_modality(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = _anthropic_adapter()
    published = [
        AnthropicModel.model_validate(
            {
                "id": "claude-opus-5",
                "display_name": "Claude Opus 5",
                "max_input_tokens": 1_000_000,
                "capabilities": {"image_input": {"supported": True}},
            }
        ),
        AnthropicModel.model_validate(
            {
                "id": "claude-text-only",
                "display_name": "Text only",
                "max_input_tokens": 200_000,
                "capabilities": {"image_input": {"supported": False}},
            }
        ),
        AnthropicModel.model_validate(
            {
                "id": "claude-unpublished",
                "display_name": "Publishes nothing",
                "max_input_tokens": 200_000,
                "capabilities": {},
            }
        ),
    ]

    class _Client:
        @staticmethod
        def list_models(force_refresh: bool = False):
            return _snapshot(published)

    monkeypatch.setattr(adapter, "_client", lambda: _Client())

    catalog = {model.id: model for model in adapter.list_models(ProviderKind.CHAT).models}

    assert catalog["claude-opus-5"].input_modalities == ["text", "image"]
    assert catalog["claude-text-only"].input_modalities == ["text"]
    # A model that publishes no capability tree claims nothing beyond text:
    # a guessed capability is a request the user cannot make work.
    assert catalog["claude-unpublished"].input_modalities == ["text"]


def _openrouter_adapter() -> OpenRouterAdapter:
    return OpenRouterAdapter(
        models.ProviderConnection(
            user_id=uuid4(),
            provider_type="openrouter",
            label="OpenRouter",
            config={"api_key": "sk-or-test"},
        )
    )


def test_openrouter_chat_models_carry_their_published_modalities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The chat catalog states modalities, not just the reranking catalog.

    OpenRouter publishes `architecture.input_modalities` per model; a chat
    catalog that dropped it made every vision model on the largest provider
    look text-only, so a capability filter hid the models it exists to find.
    """
    adapter = _openrouter_adapter()
    published = [
        ModelInfo(
            id="google/gemini-3-pro",
            name="Gemini 3 Pro",
            context_length=2_000_000,
            architecture={
                "input_modalities": ["text", "image"],
                "output_modalities": ["text"],
            },
        ),
        ModelInfo(
            id="text/only",
            name="Text only",
            context_length=8_192,
            architecture={"input_modalities": ["text"], "output_modalities": ["text"]},
        ),
        ModelInfo(id="publishes/nothing", name="Publishes nothing", context_length=8_192),
    ]

    class _Client:
        @staticmethod
        def list_models(force_refresh: bool = False):
            return _snapshot(published)

    monkeypatch.setattr(adapter, "_client", lambda: _Client())

    catalog = {model.id: model for model in adapter.list_models(ProviderKind.CHAT).models}

    assert catalog["google/gemini-3-pro"].input_modalities == ["text", "image"]
    assert catalog["text/only"].input_modalities == ["text"]
    assert catalog["publishes/nothing"].input_modalities == []


def test_openrouter_embedding_models_carry_their_published_modalities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The embedding catalog states modalities too, from its own endpoint.

    Embedding models come from `/embeddings/models`, which publishes the same
    `architecture` block the chat listing does. A branch that reads it for
    chat and drops it here makes every multimodal embedding model look
    text-only, so a pipeline keeps its text floor and routes images nowhere.
    """
    from app.schemas.models import EmbeddingModelInfo

    adapter = _openrouter_adapter()
    published = [
        EmbeddingModelInfo(
            id="voyageai/voyage-multimodal-3.5",
            name="voyage-multimodal-3.5",
            input_modalities=["text", "image"],
            output_modalities=["embeddings"],
        ),
        EmbeddingModelInfo(
            id="openai/text-embedding-3-small",
            name="text-embedding-3-small",
            input_modalities=["text"],
            output_modalities=["embeddings"],
        ),
    ]

    class _Client:
        @staticmethod
        def list_embedding_models(force_refresh: bool = False):
            return _snapshot(published)

    monkeypatch.setattr(adapter, "_client", lambda: _Client())

    catalog = {model.id: model for model in adapter.list_models(ProviderKind.EMBEDDING).models}

    assert catalog["voyageai/voyage-multimodal-3.5"].input_modalities == ["text", "image"]
    assert catalog["openai/text-embedding-3-small"].input_modalities == ["text"]


def test_openrouter_embedding_listing_reads_the_architecture_block() -> None:
    """The client parses modalities off the raw listing, not just passes them on."""
    from app.clients.openrouter.client import OpenRouterClient

    payload = {
        "data": [
            {
                "id": "voyageai/voyage-multimodal-3.5",
                "name": "voyage-multimodal-3.5",
                "context_length": 32000,
                "architecture": {
                    "input_modalities": ["text", "image"],
                    "output_modalities": ["embeddings"],
                },
            },
            {"id": "bare/model", "name": "Bare"},
        ]
    }
    client = OpenRouterClient.__new__(OpenRouterClient)
    object.__setattr__(client, "_get_json", lambda _path: payload)

    models_by_id = {model.id: model for model in client._fetch_embedding_models()}

    assert models_by_id["voyageai/voyage-multimodal-3.5"].input_modalities == ["text", "image"]
    assert models_by_id["bare/model"].input_modalities == []
