"""Shipped prompt seeding.

Every default prompt Ragworks ships is a library row (`source: shipped`)
with a stable `shipped_key`, seeded per user — a fresh account opens the
studio to a populated library, and every default consumer references
these rows instead of carrying inline text. Seeding is idempotent by
key; when a release improves a shipped body, a new version is appended
*once* (a body any existing version already carries is never re-appended,
so a user's own edits on top of a shipped prompt don't accumulate
shipped re-stamps on every boot).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.pipelines.llm.presets import (
    GENERATE_PRESETS,
    RERANK_PRESETS,
    TRANSFORM_PRESETS,
)
from app.pipelines.node import NodePreset
from app.schemas.enums import PromptContext, PromptSource
from app.services.prompts.templates import (
    DEFAULT_BASE_PROMPT_TEMPLATE,
    DEFAULT_SYSTEM_PROMPT_TEMPLATE,
)

#: Shipped keys the chat consumers fall back to.
BASE_PROMPT_KEY = "chat.base-default"
TOOL_PROMPT_KEY = "chat.tool-default"


@dataclass(frozen=True)
class ShippedPromptSpec:
    """One prompt Ragworks ships."""

    key: str
    name: str
    description: str
    context: PromptContext
    body: str
    system_body: str | None = None
    output_fields: list[dict[str, object]] | None = None


def _preset_specs(
    presets: tuple[NodePreset, ...], context: PromptContext
) -> list[ShippedPromptSpec]:
    specs: list[ShippedPromptSpec] = []
    for preset in presets:
        body = preset.config.get("prompt")
        if not isinstance(body, str) or not body.strip():
            continue
        system = preset.config.get("system_prompt")
        fields = preset.config.get("output_fields")
        specs.append(
            ShippedPromptSpec(
                key=f"preset.{preset.id}",
                name=preset.label,
                description=preset.description,
                context=context,
                body=body,
                system_body=system if isinstance(system, str) and system.strip() else None,
                output_fields=fields if isinstance(fields, list) and fields else None,
            )
        )
    return specs


def shipped_prompt_specs() -> list[ShippedPromptSpec]:
    """Every prompt Ragworks ships, chat defaults first."""
    return [
        ShippedPromptSpec(
            key=BASE_PROMPT_KEY,
            name="Ragworks base prompt",
            description="The default chat system prompt: identity, guardrails, session context.",
            context=PromptContext.CHAT_BASE,
            body=DEFAULT_BASE_PROMPT_TEMPLATE,
        ),
        ShippedPromptSpec(
            key=TOOL_PROMPT_KEY,
            name="Collection tool prompt",
            description="The default per-collection section describing its search tool.",
            context=PromptContext.CHAT_TOOL,
            body=DEFAULT_SYSTEM_PROMPT_TEMPLATE,
        ),
        *_preset_specs(TRANSFORM_PRESETS, PromptContext.NODE_TRANSFORM),
        *_preset_specs(RERANK_PRESETS, PromptContext.NODE_RERANK),
        *_preset_specs(GENERATE_PRESETS, PromptContext.NODE_GENERATE),
    ]


def seed_shipped_prompts(session: Session, user_id: UUID) -> dict[str, models.Prompt]:
    """Ensure every shipped prompt exists for a user; returns them by key.

    Import stays local to avoid a cycle: `library` imports `usage`, which
    reads pipeline rows this module never touches.
    """
    from app.db.repositories import PromptRepository, PromptVersionRepository

    prompts_repo = PromptRepository(session)
    versions_repo = PromptVersionRepository(session)
    seeded: dict[str, models.Prompt] = {}
    for spec in shipped_prompt_specs():
        prompt = prompts_repo.get_by_shipped_key(user_id, spec.key)
        if prompt is None:
            prompt = prompts_repo.add(
                models.Prompt(
                    user_id=user_id,
                    name=spec.name,
                    description=spec.description,
                    context=spec.context,
                    source=PromptSource.SHIPPED,
                    shipped_key=spec.key,
                    current_version=1,
                )
            )
            versions_repo.add(
                models.PromptVersion(
                    prompt_id=prompt.id,
                    version=1,
                    body=spec.body,
                    system_body=spec.system_body,
                    label="Built-in",
                    output_fields=spec.output_fields,
                )
            )
        else:
            existing = versions_repo.list_for_prompt(prompt.id)
            match = next(
                (
                    row
                    for row in existing
                    if row.body == spec.body and (row.system_body or None) == spec.system_body
                ),
                None,
            )
            if match is None:
                next_version = prompt.current_version + 1
                versions_repo.add(
                    models.PromptVersion(
                        prompt_id=prompt.id,
                        version=next_version,
                        body=spec.body,
                        system_body=spec.system_body,
                        label="Built-in update",
                        output_fields=spec.output_fields,
                    )
                )
                prompt.current_version = next_version
                session.add(prompt)
                session.flush()
            elif spec.output_fields is not None and match.output_fields is None:
                # Text-identical version missing its schema: enrich in place
                # rather than appending a version whose body didn't change —
                # the fields ship with the same preset the body came from.
                match.output_fields = spec.output_fields
                session.add(match)
                session.flush()
        seeded[spec.key] = prompt
    return seeded
