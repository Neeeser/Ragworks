"""Sparse runtime-config overrides: one row per admin-overridden config field."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import JSON, Column, String
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin


class AppSetting(SQLModel, TimestampMixin, table=True):
    """A single overridden config field (dotted key → JSON value)."""

    __tablename__ = "app_settings"

    key: str = Field(sa_column=Column(String, primary_key=True))
    value: Any = Field(default=None, sa_column=Column(JSON, nullable=True))
    updated_by: UUID | None = Field(default=None, foreign_key="users.id", nullable=True)
