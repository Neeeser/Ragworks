from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable


def ensure_utc(timestamp: datetime) -> datetime:
    """Return a timezone-aware datetime fixed to UTC."""
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    return timestamp.astimezone(timezone.utc)


def format_datetime(timestamp: datetime) -> str:
    """Format datetimes as ISO strings that explicitly include the UTC zone."""
    return ensure_utc(timestamp).isoformat().replace("+00:00", "Z")


DEFAULT_DATETIME_ENCODERS: dict[type[datetime], Callable[[datetime], str]] = {
    datetime: format_datetime,
}


def utc_now() -> datetime:
    """Return the current UTC time as a timezone-aware datetime."""
    return datetime.now(timezone.utc)
