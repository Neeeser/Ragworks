"""Shared schema configuration for Pydantic models."""

from __future__ import annotations

from typing import ClassVar

from pydantic import ConfigDict

from app.utils.time import DEFAULT_DATETIME_ENCODERS


class DateTimeConfigMixin:
    """Mixin for schemas that need UTC-inclusive datetime serialization."""

    # Explicitly a ClassVar: this is a plain mixin (not a BaseModel), and without
    # this annotation the pydantic mypy plugin treats `model_config` on subclasses
    # as an instance field, conflicting with this class-level default.
    model_config: ClassVar[ConfigDict] = ConfigDict(json_encoders=DEFAULT_DATETIME_ENCODERS)
