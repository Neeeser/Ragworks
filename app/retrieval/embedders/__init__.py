from __future__ import annotations

from .base import Embedder

__all__ = ["Embedder", "SentenceTransformerEmbedder"]


def __getattr__(name: str):
    if name == "SentenceTransformerEmbedder":
        from .sentence_transformer import SentenceTransformerEmbedder

        return SentenceTransformerEmbedder
    raise AttributeError(f"module {__name__} has no attribute {name!r}")
