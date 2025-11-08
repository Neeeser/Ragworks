from __future__ import annotations

from .base import Reranker

__all__ = ["Reranker", "CrossEncoderReranker"]


def __getattr__(name: str):
    if name == "CrossEncoderReranker":
        from .cross_encoder import CrossEncoderReranker

        return CrossEncoderReranker
    raise AttributeError(f"module {__name__} has no attribute {name!r}")
