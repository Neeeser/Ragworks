from __future__ import annotations

from pydantic import ConfigDict

from app.utils.time import DEFAULT_DATETIME_ENCODERS


class DateTimeConfigMixin:
    """Mixin for schemas that need UTC-inclusive datetime serialization."""

    model_config = ConfigDict(json_encoders=DEFAULT_DATETIME_ENCODERS)
