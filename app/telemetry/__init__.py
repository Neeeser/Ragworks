"""Telemetry subsystem: typed activity events recorded to the local database.

Public API: ``record`` (plus ``purge_expired`` for the startup retention
sweep). Event models are imported from ``app.telemetry.events``.
"""

from __future__ import annotations

from app.telemetry.recorder import purge_expired, record

__all__ = ["purge_expired", "record"]
