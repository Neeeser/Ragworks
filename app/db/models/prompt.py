"""Prompt library tables: named prompts and their immutable versions."""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, Column, String, Text
from sqlmodel import Field, SQLModel

from app.db.models.user import TimestampMixin
from app.schemas.enums import PromptContext, PromptSource


class Prompt(SQLModel, TimestampMixin, table=True):
    """A named, versioned prompt owned by a user.

    Every prompt in the app is one of these rows — consumers store
    `{prompt_id, version|"latest"}` references, never raw template text.
    Shipped defaults carry a stable `shipped_key` so a release can append
    an improved version to the same row; forks and user prompts carry
    NULL there.
    """

    __tablename__ = "prompts"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    user_id: UUID = Field(foreign_key="users.id", nullable=False, index=True)
    name: str = Field(sa_column=Column(String, nullable=False))
    description: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    context: PromptContext = Field(sa_column=Column(String, nullable=False, index=True))
    source: PromptSource = Field(
        default=PromptSource.USER,
        sa_column=Column(String, nullable=False),
    )
    shipped_key: str | None = Field(
        default=None,
        sa_column=Column(String, nullable=True, index=True),
    )
    current_version: int = Field(default=1, nullable=False)


class PromptVersion(SQLModel, TimestampMixin, table=True):
    """One immutable revision of a prompt.

    `body` is the user/main template; `system_body` is the paired system
    template for contexts that carry one (the LLM node shells). Chat
    contexts leave it NULL. Node-context versions may carry
    `output_fields` — the structured-output schema that belongs with the
    prompt text; nodes seed their config from it but keep their own copy.
    """

    __tablename__ = "prompt_versions"

    id: UUID = Field(default_factory=uuid4, primary_key=True, index=True)
    prompt_id: UUID = Field(foreign_key="prompts.id", nullable=False, index=True)
    version: int = Field(nullable=False, index=True)
    body: str = Field(sa_column=Column(Text, nullable=False))
    system_body: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    label: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    output_fields: list[dict[str, Any]] | None = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
