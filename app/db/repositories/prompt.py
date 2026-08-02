"""Repositories for the prompt library and its versions."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete as sa_delete
from sqlalchemy import desc
from sqlmodel import col, select

from app.db import models
from app.db.repositories.base import Repository, user_scoped


class PromptRepository(Repository):
    """Data access helpers for prompt library entries."""

    def list_for_user(self, user_id: UUID) -> list[models.Prompt]:
        """List a user's prompts, most recently updated first."""
        statement = (
            select(models.Prompt)
            .where(models.Prompt.user_id == user_id)
            .order_by(desc(col(models.Prompt.updated_at)))
        )
        return list(self.session.exec(statement).all())

    def get(self, prompt_id: UUID, user_id: UUID | None = None) -> models.Prompt | None:
        """Return a prompt by id, optionally scoped to a user."""
        statement = select(models.Prompt).where(models.Prompt.id == prompt_id)
        statement = user_scoped(statement, models.Prompt, user_id)
        return self.session.exec(statement).first()

    def get_by_shipped_key(self, user_id: UUID, shipped_key: str) -> models.Prompt | None:
        """Return the user's prompt seeded for a shipped key."""
        statement = select(models.Prompt).where(
            col(models.Prompt.user_id) == user_id,
            col(models.Prompt.shipped_key) == shipped_key,
        )
        return self.session.exec(statement).first()

    def add(self, prompt: models.Prompt) -> models.Prompt:
        """Persist a new prompt and return it."""
        return self._add(prompt)


class PromptVersionRepository(Repository):
    """Data access helpers for prompt versions."""

    def list_for_prompt(self, prompt_id: UUID) -> list[models.PromptVersion]:
        """List versions for a prompt in descending order."""
        statement = (
            select(models.PromptVersion)
            .where(models.PromptVersion.prompt_id == prompt_id)
            .order_by(desc(col(models.PromptVersion.version)))
        )
        return list(self.session.exec(statement).all())

    def get_by_version(self, prompt_id: UUID, version: int) -> models.PromptVersion | None:
        """Return a specific version of a prompt."""
        statement = select(models.PromptVersion).where(
            col(models.PromptVersion.prompt_id) == prompt_id,
            col(models.PromptVersion.version) == version,
        )
        return self.session.exec(statement).first()

    def delete_for_prompt(self, prompt_id: UUID) -> None:
        """Delete every version belonging to a prompt; the caller flushes."""
        self.session.execute(
            sa_delete(models.PromptVersion).where(
                col(models.PromptVersion.prompt_id) == prompt_id,
            )
        )

    def add(self, version: models.PromptVersion) -> models.PromptVersion:
        """Persist a prompt version and return it."""
        return self._add(version)
