from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schemas.base import DateTimeConfigMixin
from app.utils.time import DEFAULT_DATETIME_ENCODERS, ensure_utc, format_datetime, utc_now
from pydantic import BaseModel


class SampleModel(DateTimeConfigMixin, BaseModel):
    timestamp: datetime


def test_ensure_utc_converts_naive_timestamp() -> None:
    naive = datetime(2025, 5, 17, 12, 0, 0)
    converted = ensure_utc(naive)
    assert converted.tzinfo == timezone.utc
    assert converted.hour == 12


def test_ensure_utc_preserves_other_zones() -> None:
    source = datetime(2025, 5, 17, 5, 0, 0, tzinfo=timezone(timedelta(hours=-5)))
    converted = ensure_utc(source)
    assert converted.tzinfo == timezone.utc
    assert converted.hour == 10


def test_format_datetime_includes_z_suffix() -> None:
    timestamp = datetime(2025, 5, 17, 12, 0, 0, tzinfo=timezone.utc)
    assert format_datetime(timestamp).endswith("Z")
    assert "2025-05-17T12:00:00Z" in format_datetime(timestamp)


def test_default_encoder_aliases() -> None:
    timestamp = datetime(2025, 5, 17, 12, 30, 0)
    encoder = DEFAULT_DATETIME_ENCODERS[datetime]
    assert encoder(timestamp).endswith("Z")


def test_mixin_serializes_to_iso() -> None:
    model = SampleModel(timestamp=datetime(2025, 12, 1, 3, 45, 0))
    serialized = model.model_dump_json()
    assert '"timestamp":"2025-12-01T03:45:00Z"' in serialized


def test_utc_now_is_timezone_aware() -> None:
    now = utc_now()
    assert now.tzinfo == timezone.utc
