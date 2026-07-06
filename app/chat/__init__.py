"""Chat subsystem public API.

Only `ChatService` is exported here — it is the subsystem's entry point. Other
modules (`app.chat.persistence`, `app.chat.events`, …) are imported directly by
their consumers. Foreign symbols are never re-exported to serve as test
monkeypatch back-doors: tests patch at the real boundary where a name is used.
"""

from __future__ import annotations

from app.chat.service import ChatService

__all__ = ["ChatService"]
