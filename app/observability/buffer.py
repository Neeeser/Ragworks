"""In-memory ring buffer of recent log records for diagnostics export.

A fixed-size, thread-safe, process-lifetime store of already-redacted event
dicts. It powers the admin "Download diagnostics" bundle without introducing
an application-managed log file: the durable history is the stdout stream the
container operator collects, and this buffer is the recent tail an operator can
export from the UI. It sits *after* redaction in the logging pipeline, so an
export can never contain anything stdout could not.

Restart-scoped by design — a process crash loses the buffer, but ``docker
logs`` still holds the stdout tail up to the crash.
"""

from __future__ import annotations

import threading
from collections import deque
from typing import Any

from structlog.types import EventDict, WrappedLogger

DEFAULT_CAPACITY = 5000


class LogRingBuffer:
    """A bounded, thread-safe FIFO of redacted log-event dicts."""

    def __init__(self, capacity: int = DEFAULT_CAPACITY) -> None:
        """Create a buffer holding at most ``capacity`` records."""
        self.capacity = capacity
        self._records: deque[dict[str, Any]] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def append(self, record: dict[str, Any]) -> None:
        """Append one record, evicting the oldest when at capacity."""
        with self._lock:
            self._records.append(record)

    def snapshot(self) -> list[dict[str, Any]]:
        """Return a shallow copy of the current records, oldest first."""
        with self._lock:
            return list(self._records)

    def clear(self) -> None:
        """Drop every buffered record."""
        with self._lock:
            self._records.clear()


_buffer = LogRingBuffer()

# Keys structlog's ProcessorFormatter seeds onto a *foreign* stdlib record's
# event dict before the shared pre-chain runs. `remove_processors_meta` strips
# them in the render chain, but that runs after this buffer tee — so the tee
# must drop them itself, or `_record` (a raw, unserializable `logging.LogRecord`)
# lands in an exported bundle and 500s the admin export.
_META_KEYS = ("_record", "_from_structlog")


def get_log_buffer() -> LogRingBuffer:
    """Return the process-wide log ring buffer."""
    return _buffer


def buffer_processor(_logger: WrappedLogger, _method_name: str, event_dict: EventDict) -> EventDict:
    """structlog processor: tee a copy of the redacted event into the buffer."""
    _buffer.append({k: v for k, v in event_dict.items() if k not in _META_KEYS})
    return event_dict
