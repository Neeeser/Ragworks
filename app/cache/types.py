"""Public, provider-agnostic cache value types."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, Literal, TypeVar

ValueT = TypeVar("ValueT")


@dataclass(frozen=True)
class CachePolicy:
    """Freshness and capacity policy for a process-local value cache."""

    fresh_seconds: float | None
    max_stale_seconds: float
    failure_retry_seconds: float
    max_entries: int

    def __post_init__(self) -> None:
        """Reject policies whose timing or capacity cannot be honored."""
        if self.fresh_seconds is not None and self.fresh_seconds < 0:
            raise ValueError("fresh_seconds must be non-negative or None")
        if self.max_stale_seconds < 0:
            raise ValueError("max_stale_seconds must be non-negative")
        if self.failure_retry_seconds < 0:
            raise ValueError("failure_retry_seconds must be non-negative")
        if self.max_entries < 1:
            raise ValueError("max_entries must be at least one")


@dataclass(frozen=True)
class CacheSnapshot(Generic[ValueT]):
    """A cached value together with its current freshness state."""

    value: ValueT
    freshness: Literal["fresh", "stale"]
    age_seconds: float
    refreshing: bool
    warning: str | None
