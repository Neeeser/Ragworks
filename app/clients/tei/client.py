"""Typed HTTP client for Hugging Face Text Embeddings Inference (TEI)."""

from __future__ import annotations

from collections.abc import Iterable

import httpx
from pydantic import TypeAdapter

from app.cache import ResourceCache
from app.clients.tei.schemas import TEIInfo, TEIRerankResult

_embedding_vectors = TypeAdapter(list[list[float]])
_rerank_results = TypeAdapter(list[TEIRerankResult])


class TEIClient:
    """HTTP client bound to one TEI server and its optional proxy credential."""

    def __init__(self, base_url: str, api_key: str | None = None) -> None:
        """Initialize TEI transport, normalizing a server URL once."""
        resolved_url = (base_url or "").strip().rstrip("/")
        if not resolved_url:
            raise ValueError("TEI base URL must be provided.")
        headers: dict[str, str] = {}
        resolved_key = (api_key or "").strip()
        if resolved_key:
            headers["Authorization"] = f"Bearer {resolved_key}"
        self._http = httpx.Client(
            base_url=resolved_url,
            headers=headers,
            timeout=httpx.Timeout(60.0, connect=5.0),
        )

    def info(self) -> TEIInfo:
        """Return the served model's task and input-limit metadata."""
        response = self._http.get("/info")
        response.raise_for_status()
        return TEIInfo.model_validate(response.json())

    def embed(self, texts: Iterable[str]) -> list[list[float]]:
        """Embed text inputs through TEI's native ``POST /embed`` endpoint."""
        response = self._http.post("/embed", json={"inputs": list(texts)})
        response.raise_for_status()
        return _embedding_vectors.validate_python(response.json())

    def rerank(self, query: str, texts: Iterable[str]) -> list[TEIRerankResult]:
        """Score text inputs against a query through TEI's native rerank endpoint."""
        response = self._http.post("/rerank", json={"query": query, "texts": list(texts)})
        response.raise_for_status()
        return _rerank_results.validate_python(response.json())

    def close(self) -> None:
        """Close the owned HTTP connection pool."""
        self._http.close()


TEIClientKey = tuple[str, str]


def _client_key(base_url: str, api_key: str | None) -> TEIClientKey:
    return (base_url.strip().rstrip("/"), (api_key or "").strip())


_client_cache: ResourceCache[TEIClientKey, TEIClient] = ResourceCache(
    max_entries=64, key_material=lambda key: "\n".join(key)
)


def get_tei_client(base_url: str, api_key: str | None = None) -> TEIClient:
    """Return the cached client for a TEI server configuration."""
    return _client_cache.get_or_create(
        _client_key(base_url, api_key), lambda: TEIClient(base_url, api_key)
    )


def invalidate_tei_client(base_url: str, api_key: str | None = None) -> bool:
    """Close a cached TEI client after its connection changes."""
    return _client_cache.invalidate(_client_key(base_url, api_key))


def close_tei_clients() -> None:
    """Close all cached TEI clients during application shutdown."""
    _client_cache.close_all()
