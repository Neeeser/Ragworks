"""Adapter-level behavior for OpenRouter provider connections."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.cache import CacheSnapshot
from app.db import models
from app.providers.openrouter import OpenRouterAdapter
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import ModelInfo


def _connection() -> models.ProviderConnection:
    """Build an OpenRouter connection without persisting credentials."""
    return models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.OPENROUTER.value,
        label="OpenRouter test",
        config={"api_key": "test-key"},
    )


def test_reranking_catalog_preserves_context_and_modalities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixture = ModelInfo(
        id="nvidia/rerank-vl",
        name="Rerank VL",
        context_length=10240,
        architecture={
            "input_modalities": ["text", "image"],
            "output_modalities": ["rerank"],
        },
    )

    class _Client:
        @staticmethod
        def list_rerank_models(*, force_refresh: bool = False) -> CacheSnapshot[list[ModelInfo]]:
            assert force_refresh is True
            return CacheSnapshot(
                value=[fixture],
                freshness="fresh",
                age_seconds=0,
                refreshing=False,
                warning=None,
            )

    adapter = OpenRouterAdapter(_connection())
    monkeypatch.setattr(adapter, "_client", lambda: _Client())

    result = adapter.list_models(ProviderKind.RERANKING, force_refresh=True)

    assert len(result.models) == 1
    public = result.models[0]
    assert public.context_length == 10240
    assert public.input_modalities == ["text", "image"]
    assert public.output_modalities == ["rerank"]
