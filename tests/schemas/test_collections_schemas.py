"""Wire-serialization contract tests for collection schemas."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

from app.schemas.collections import CollectionStatsRead


def test_stats_last_used_at_serializes_with_utc_zone() -> None:
    """Naive DB timestamps must reach the wire marked as UTC.

    Regression: ``last_used_at`` used to serialize without a zone suffix, so
    browsers parsed it as local time and showed times hours behind reality.
    """
    stats = CollectionStatsRead(
        collection_id=uuid4(),
        document_count=1,
        chunk_count=2,
        last_used_at=datetime(2026, 7, 12, 15, 30, 0),
    )

    payload = json.loads(stats.model_dump_json())
    assert payload["last_used_at"] == "2026-07-12T15:30:00Z"

    aware = stats.model_copy(update={"last_used_at": datetime(2026, 7, 12, 15, 30, tzinfo=UTC)})
    assert json.loads(aware.model_dump_json())["last_used_at"] == "2026-07-12T15:30:00Z"
