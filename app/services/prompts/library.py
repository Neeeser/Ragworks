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

from pydantic import TypeAdapter, ValidationError
from sqlmodel import Session

from app.db import models
from app.db.repositories import PromptRepository, PromptVersionRepository
from app.pipelines.llm.config import OutputFieldSpec
from app.pipelines.llm.validation import CONTEXT_TARGETS
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

SHIPPED_READ_ONLY_DETAIL = (
    "Shipped prompts are read-only so release updates never fight your "
    "edits — fork it to make it yours."
)

_OUTPUT_FIELDS = TypeAdapter(list[OutputFieldSpec])


@dataclass(frozen=True)
class ResolvedPrompt:
    """A reference resolved to concrete template text."""

    prompt: models.Prompt
    version: models.PromptVersion


def _ensure_editable(prompt: models.Prompt) -> None:
    """Refuse mutations on shipped prompts.

    Shipped rows only ever hold shipped versions, so a release appending
    an improved default can never shadow a user's edit — the edit lives
    on a fork instead. `==` on purpose: DB-loaded enum columns are raw
    strings.
    """
    if prompt.source == PromptSource.SHIPPED:
        raise InvalidInputError(SHIPPED_READ_ONLY_DETAIL)


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


def validate_output_fields(
    context: PromptContext, raw: list[dict[str, object]] | None
) -> list[dict[str, object]] | None:
    """Validate a version's output-field schema for its context.

    Only node contexts run the structured-output engine, so only they may
    carry a schema; targets are checked against the owning shell's allowed
    set (`CONTEXT_TARGETS`) — the same rule node validation enforces.
    Returns the normalized field list, or None for an absent/empty one.
    """
    if not raw:
        return None
    targets = CONTEXT_TARGETS.get(context)
    if targets is None:
        raise InvalidInputError(
            "Output fields only apply to node-context prompts — chat prompts "
            "have no structured output."
        )
    try:
        fields = _OUTPUT_FIELDS.validate_python(raw)
    except ValidationError as exc:
        raise InvalidInputError(f"Invalid output fields: {exc}") from exc
    bad = sorted({spec.target.kind for spec in fields} - targets)
    if bad:
        kinds = ", ".join(f"'{kind}'" for kind in bad)
        raise InvalidInputError(
            f"This context cannot write output fields targeting {kinds}."
        )
    return [spec.model_dump(mode="json") for spec in fields]


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
        output_fields = validate_output_fields(payload.context, payload.output_fields)
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
                output_fields=output_fields,
            )
        )
        return prompt

    def update(self, user_id: UUID, prompt_id: UUID, payload: PromptUpdate) -> models.Prompt:
        """Rename or redescribe a prompt; bodies change through versions."""
        prompt = self.get(user_id, prompt_id)
        _ensure_editable(prompt)
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
        _ensure_editable(prompt)
        validate_template_body(prompt.context, payload.body, payload.system_body)
        output_fields = validate_output_fields(prompt.context, payload.output_fields)
        next_version = prompt.current_version + 1
        version = self.versions.add(
            models.PromptVersion(
                prompt_id=prompt.id,
                version=next_version,
                body=payload.body,
                system_body=payload.system_body,
                label=payload.label,
                output_fields=output_fields,
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
        """Create a new prompt seeded from one version of an existing one.

        A payload carrying a `body` is the fork-and-edit path: the caller's
        draft (body, system body, output fields, as given) becomes v1
        instead of the source version's text.
        """
        source_prompt = self.get(user_id, prompt_id)
        source_version = self._version_row(source_prompt, payload.version)
        context = payload.context or source_prompt.context
        if payload.body is None:
            body = source_version.body
            system_body = source_version.system_body
            output_fields = source_version.output_fields
        else:
            body = payload.body or source_version.body
            system_body = payload.system_body
            output_fields = payload.output_fields
        return self.create(
            user_id,
            PromptCreate(
                name=payload.name,
                description=payload.description,
                context=context,
                body=body,
                system_body=system_body,
                output_fields=output_fields,
            ),
        )

    def delete(self, user_id: UUID, prompt_id: UUID) -> None:
        """Delete a prompt and its versions; refuses while referenced.

        Shipped prompts refuse too: seeding would recreate the row on the
        next boot, so the delete would only ever look like it worked.
        """
        from app.services.prompts.usage import prompt_usages

        prompt = self.get(user_id, prompt_id)
        _ensure_editable(prompt)
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
