"""TTL-cached, capability-classified catalog of one Ollama server's models.

Transport is injected as callables (mirroring the OpenRouter `ModelCatalog`)
so this module holds only caching/shaping logic. Classification and dimension
discovery read `/api/show` metadata — never an embed probe, which would load
every model into the server's memory just to list them.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from app.schemas.ollama import (
    OllamaModelDescription,
    OllamaShowResponse,
    OllamaTagsResponse,
)

_CACHE_TTL_SECONDS = 300.0


def _architecture_int(model_info: dict[str, Any], suffix: str) -> int | None:
    """Read an architecture-prefixed integer (`{arch}.{suffix}`) from model_info."""
    architecture = model_info.get("general.architecture")
    if not isinstance(architecture, str):
        return None
    value = model_info.get(f"{architecture}.{suffix}")
    return value if isinstance(value, int) else None


class OllamaCatalog:
    """Caches the described-model listing for `_CACHE_TTL_SECONDS`.

    `/api/show` results are cached per model name for the same TTL window as
    the tags listing so a listing refresh re-checks capabilities without
    re-fetching unchanged models within the window.
    """

    def __init__(
        self,
        fetch_tags: Callable[[], OllamaTagsResponse],
        fetch_show: Callable[[str], OllamaShowResponse],
    ) -> None:
        """Store the injected fetch callables and initialize empty caches."""
        self._fetch_tags = fetch_tags
        self._fetch_show = fetch_show
        self._described: list[OllamaModelDescription] = []
        self._described_ts = 0.0
        self._shows: dict[str, OllamaShowResponse] = {}

    def describe_models(self, force_refresh: bool = False) -> list[OllamaModelDescription]:
        """Return capability-classified descriptions of every local model."""
        now = time.time()
        if (
            not force_refresh
            and now - self._described_ts < _CACHE_TTL_SECONDS
            and self._described
        ):
            return self._described
        # The listing is being refreshed (TTL expiry or force) — drop the
        # per-model show cache with it so re-pulled models pick up new
        # capabilities/metadata within the same window.
        self._shows = {}
        described: list[OllamaModelDescription] = []
        for summary in self._fetch_tags().models:
            show = self._shows.get(summary.name)
            if show is None:
                show = self._fetch_show(summary.name)
                self._shows[summary.name] = show
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
        self._described = described
        self._described_ts = now
        return self._described
