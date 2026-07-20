"""Order-preserving sequence helpers."""

from __future__ import annotations

from collections.abc import Hashable, Iterable
from typing import TypeVar

T = TypeVar("T", bound=Hashable)


def unique_in_order(items: Iterable[T]) -> list[T]:
    """Deduplicate items while preserving first-seen order."""
    seen: set[T] = set()
    ordered: list[T] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered
