"""Shared stub factories for pipeline node/execution tests.

`OpenRouterEmbedder` and `PineconeIndexer` get monkeypatched out in several
node tests with slightly different canned results. Before this, each test
re-declared its own `_StubEmbedder`/`_StubIndexer` class body (8 copies across
`test_pipeline_nodes.py`); these factories build a fresh stub class per call
so each test shapes only the behavior it needs.
"""

from __future__ import annotations

from collections.abc import Callable


def make_stub_embedder(
    *,
    usage: dict[str, int] | None = None,
    documents_result: list[list[float]] | None = None,
    query_result: list[float] | None = None,
) -> type:
    """Build a stand-in class for OpenRouterEmbedder with canned results.

    `documents_result`/`query_result` default to a fixed two-value vector per
    input when not given, matching the placeholder embeddings the original
    per-test stubs used.
    """

    class _StubEmbedder:
        def __init__(
            self,
            _client: object,
            _model_name: str,
            *,
            dimensions: int | None = None,
        ) -> None:
            self.usage = usage or {}

        def embed_documents(self, chunks: list[object]) -> list[list[float]]:
            if documents_result is not None:
                return documents_result
            return [[0.1, 0.2] for _ in chunks]

        def embed_query(self, _query: str) -> list[float]:
            if query_result is not None:
                return query_result
            return [0.1, 0.2]

    return _StubEmbedder


def make_stub_indexer(
    *,
    on_ensure_index: Callable[[object], None] | None = None,
    on_upsert: Callable[[dict[str, object]], None] | None = None,
) -> type:
    """Build a stand-in class for PineconeIndexer that records calls via callbacks."""

    class _StubIndexer:
        def __init__(self, client: object) -> None:
            self.client = client

        def ensure_index(self, config: object) -> None:
            if on_ensure_index:
                on_ensure_index(config)

        def upsert(self, **kwargs: object) -> None:
            if on_upsert:
                on_upsert(kwargs)

    return _StubIndexer
