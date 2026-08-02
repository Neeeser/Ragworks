"""The prompt library: CRUD, immutable versions, forks, and resolution.

Every prompt in the app is a `Prompt` row with `PromptVersion` revisions;
consumers hold `{prompt_id, version|"latest"}` references resolved here.
Template bodies are validated strictly against the context's variable
catalog at save time — rendering stays lenient so a stored prompt never
fails a chat turn.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import PromptRepository, PromptVersionRepository
from app.prompting import catalog_for, referenced_variables
from app.schemas.enums import PromptContext, PromptSource
from app.schemas.prompts import (
    PromptCreate,
    PromptForkCreate,
    PromptUpdate,
    PromptVersionCreate,
    PromptVersionSelector,
)
from app.services.errors import InvalidInputError, NotFoundError

PROMPT_NOT_FOUND_DETAIL = "Prompt not found"


@dataclass(frozen=True)
class ResolvedPrompt:
    """A reference resolved to concrete template text."""

    prompt: models.Prompt
    version: models.PromptVersion


def validate_template_body(
    context: PromptContext, body: str, system_body: str | None
) -> None:
    """Reject bodies referencing variables the context cannot supply."""
    catalog = catalog_for(context)
    unknown: list[str] = []
    for template in (body, system_body or ""):
        unknown.extend(catalog.unknown_variables(referenced_variables(template)))
    if unknown:
        names = ", ".join(f"{{{{{name}}}}}" for name in sorted(set(unknown)))
        raise InvalidInputError(
            f"Template references variables this context cannot supply: {names}."
        )


class PromptLibraryService:
    """Owns prompt entities, their versions, and reference resolution."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request session."""
        self.session = session
        self.prompts = PromptRepository(session)
        self.versions = PromptVersionRepository(session)

    def list_for_user(self, user_id: UUID) -> list[models.Prompt]:
        """List the user's prompts, most recently updated first."""
        return self.prompts.list_for_user(user_id)

    def get(self, user_id: UUID, prompt_id: UUID) -> models.Prompt:
        """Return an owned prompt or raise the cross-user 404."""
        prompt = self.prompts.get(prompt_id, user_id)
        if prompt is None:
            raise NotFoundError(PROMPT_NOT_FOUND_DETAIL)
        return prompt

    def create(
        self,
        user_id: UUID,
        payload: PromptCreate,
        *,
        source: PromptSource = PromptSource.USER,
        shipped_key: str | None = None,
    ) -> models.Prompt:
        """Create a prompt whose v1 is the supplied body."""
        validate_template_body(payload.context, payload.body, payload.system_body)
        prompt = self.prompts.add(
            models.Prompt(
                user_id=user_id,
                name=payload.name,
                description=payload.description,
                context=payload.context,
                source=source,
                shipped_key=shipped_key,
                current_version=1,
            )
        )
        self.versions.add(
            models.PromptVersion(
                prompt_id=prompt.id,
                version=1,
                body=payload.body,
                system_body=payload.system_body,
            )
        )
        return prompt

    def update(self, user_id: UUID, prompt_id: UUID, payload: PromptUpdate) -> models.Prompt:
        """Rename or redescribe a prompt; bodies change through versions."""
        prompt = self.get(user_id, prompt_id)
        if payload.name is not None:
            prompt.name = payload.name
        if payload.description is not None:
            prompt.description = payload.description
        self.session.add(prompt)
        self.session.flush()
        return prompt

    def save_version(
        self,
        user_id: UUID,
        prompt_id: UUID,
        payload: PromptVersionCreate,
    ) -> models.PromptVersion:
        """Append a new immutable version and move `current_version` to it."""
        prompt = self.get(user_id, prompt_id)
        validate_template_body(prompt.context, payload.body, payload.system_body)
        next_version = prompt.current_version + 1
        version = self.versions.add(
            models.PromptVersion(
                prompt_id=prompt.id,
                version=next_version,
                body=payload.body,
                system_body=payload.system_body,
                label=payload.label,
            )
        )
        prompt.current_version = next_version
        self.session.add(prompt)
        self.session.flush()
        return version

    def list_versions(self, user_id: UUID, prompt_id: UUID) -> list[models.PromptVersion]:
        """List a prompt's versions, newest first."""
        self.get(user_id, prompt_id)
        return self.versions.list_for_prompt(prompt_id)

    def get_version(
        self,
        user_id: UUID,
        prompt_id: UUID,
        selector: PromptVersionSelector,
    ) -> models.PromptVersion:
        """Return one version of an owned prompt (`latest` = current)."""
        prompt = self.get(user_id, prompt_id)
        return self._version_row(prompt, selector)

    def fork(self, user_id: UUID, prompt_id: UUID, payload: PromptForkCreate) -> models.Prompt:
        """Create a new prompt seeded from one version of an existing one."""
        source_prompt = self.get(user_id, prompt_id)
        source_version = self._version_row(source_prompt, payload.version)
        context = payload.context or source_prompt.context
        return self.create(
            user_id,
            PromptCreate(
                name=payload.name,
                description=payload.description,
                context=context,
                body=source_version.body,
                system_body=source_version.system_body,
            ),
        )

    def delete(self, user_id: UUID, prompt_id: UUID) -> None:
        """Delete a prompt and its versions; refuses while referenced."""
        from app.services.prompts.usage import prompt_usages

        prompt = self.get(user_id, prompt_id)
        usages = prompt_usages(self.session, user_id, prompt_id)
        if usages:
            names = ", ".join(sorted({usage.name for usage in usages}))
            raise InvalidInputError(
                f"Prompt '{prompt.name}' is still referenced by: {names}. "
                "Point those consumers at another prompt first."
            )
        self.versions.delete_for_prompt(prompt_id)
        self.session.delete(prompt)
        self.session.flush()

    def resolve(
        self,
        user_id: UUID,
        prompt_id: UUID,
        selector: PromptVersionSelector,
    ) -> ResolvedPrompt:
        """Resolve a reference to concrete template text."""
        prompt = self.get(user_id, prompt_id)
        return ResolvedPrompt(prompt=prompt, version=self._version_row(prompt, selector))

    def _version_row(
        self, prompt: models.Prompt, selector: PromptVersionSelector
    ) -> models.PromptVersion:
        version = prompt.current_version if selector == "latest" else int(selector)
        row = self.versions.get_by_version(prompt.id, version)
        if row is None:
            raise NotFoundError(f"Prompt '{prompt.name}' has no version {version}")
        return row
