"""TTL-cached, capability-classified catalog of one Ollama server's models.

Transport is injected as callables (mirroring the OpenRouter `ModelCatalog`)
so this module holds only caching/shaping logic. Classification and dimension
discovery read `/api/show` metadata — never an embed probe, which would load
every model into the server's memory just to list them.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.cache import CachePolicy, CacheSnapshot, ValueCache
from app.clients.ollama.errors import OllamaApiError
from app.schemas.ollama import (
    OllamaModelDescription,
    OllamaShowResponse,
    OllamaTagsResponse,
)

_CATALOG_POLICY = CachePolicy(
    fresh_seconds=300,
    max_stale_seconds=900,
    failure_retry_seconds=30,
    max_entries=1,
)

logger = logging.getLogger(__name__)


def _architecture_int(model_info: dict[str, Any], suffix: str) -> int | None:
    """Read an architecture-prefixed integer (`{arch}.{suffix}`) from model_info."""
    architecture = model_info.get("general.architecture")
    if not isinstance(architecture, str):
        return None
    value = model_info.get(f"{architecture}.{suffix}")
    return value if isinstance(value, int) else None


class OllamaCatalog:
    """Cache capability-classified descriptions of one server's models."""

    def __init__(
        self,
        fetch_tags: Callable[[], OllamaTagsResponse],
        fetch_show: Callable[[str], OllamaShowResponse],
    ) -> None:
        """Store the injected fetch callables and initialize empty caches."""
        self._fetch_tags = fetch_tags
        self._fetch_show = fetch_show
        self._described = ValueCache[str, list[OllamaModelDescription]](
            _CATALOG_POLICY
        )

    def describe_models(
        self, force_refresh: bool = False
    ) -> CacheSnapshot[list[OllamaModelDescription]]:
        """Return described models with cache freshness metadata."""
        return self._described.get(
            "described", self._load_described, force_refresh=force_refresh
        )

    def _load_described(self) -> list[OllamaModelDescription]:
        """Fetch tags and shape each model's current `/api/show` metadata."""
        described: list[OllamaModelDescription] = []
        for summary in self._fetch_tags().models:
            try:
                show = self._fetch_show(summary.name)
            except OllamaApiError as exc:
                logger.warning(
                    "Skipping Ollama model %s: /api/show failed: %s",
                    summary.name,
                    exc,
                )
                continue
            details = show.details or summary.details
            described.append(
                OllamaModelDescription(
                    name=summary.name,
                    capabilities=show.capabilities,
                    parameter_size=details.parameter_size if details else None,
                    quantization_level=details.quantization_level if details else None,
                    context_length=_architecture_int(show.model_info, "context_length"),
                    embedding_dimension=_architecture_int(
                        show.model_info, "embedding_length"
                    ),
                )
            )
        return described

    def close(self) -> None:
        """Wait for catalog refreshes before the owning transport closes."""
        self._described.close()
