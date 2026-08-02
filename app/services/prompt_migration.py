"""Startup migration: bring every prompt in the app onto library entities.

After this runs, no consumer carries raw prompt text: users and
collections hold references (custom text becomes an owned entity first),
and every *current* pipeline version's LLM nodes reference the library —
matching a shipped preset's text collapses onto the shipped prompt,
anything else becomes a named user prompt. Historical pipeline versions
keep their inline text (history is immutable) with only the grammar
rewritten to `{{variable}}`.

Works on raw stored JSON for pipeline definitions on purpose: the rows it
rewrites may predate the current config schema, and validating them here
would raise in `lifespan` before the fix ever runs.
"""

from __future__ import annotations

import re
from uuid import UUID

from sqlmodel import Session, select

from app.db import models
from app.db.repositories import PromptRepository, PromptVersionRepository
from app.schemas.enums import PromptContext, PromptSource
from app.schemas.prompts import PromptCreate
from app.services.prompts.seeding import (
    BASE_PROMPT_KEY,
    TOOL_PROMPT_KEY,
    seed_shipped_prompts,
    shipped_prompt_specs,
)
from app.services.prompts.usage import NODE_PROMPT_REF_KEY, TOOL_PROMPT_REF_KEY

_LEGACY_TOKEN = re.compile(
    r"\{\{|\}\}|\{(text|query|document_text|items|metadata\.[^{}\s]+)\}"
)

_NODE_CONTEXTS = {
    "llm.transform": PromptContext.NODE_TRANSFORM,
    "llm.rerank": PromptContext.NODE_RERANK,
    "llm.generate": PromptContext.NODE_GENERATE,
}


def rewrite_legacy_grammar(text: str) -> str:
    """Rewrite a single-brace node template to the `{{variable}}` grammar.

    Only texts that actually use a single-brace placeholder are legacy;
    anything else (already-migrated text, prose with JSON braces) is
    returned untouched, which is what makes the rewrite idempotent. Legacy
    `{{`/`}}` escapes become the literal braces they meant.
    """
    if not any(match.group(1) for match in _LEGACY_TOKEN.finditer(text)):
        return text

    def _substitute(match: re.Match[str]) -> str:
        token = match.group(0)
        if token == "{{":
            return "{"
        if token == "}}":
            return "}"
        return f"{{{{{match.group(1)}}}}}"

    return _LEGACY_TOKEN.sub(_substitute, text)


def migrate_prompt_entities(session: Session) -> None:
    """Seed shipped prompts and rewrite every consumer to references."""
    users = list(session.exec(select(models.User)).all())
    for user in users:
        seeded = seed_shipped_prompts(session, user.id)
        _migrate_user_base_prompt(session, user, seeded[BASE_PROMPT_KEY])
        _migrate_collections(session, user, seeded[TOOL_PROMPT_KEY])
        _migrate_pipelines(session, user)
    session.commit()


def _create_entity(
    session: Session,
    user_id: UUID,
    payload: PromptCreate,
) -> models.Prompt:
    """Create a user prompt entity without catalog validation.

    Deliberately bypasses the strict save-time check: pre-existing custom
    text may reference unknown variables, and the migration's job is to
    preserve it faithfully — the studio will show the finding when the
    prompt is next edited.
    """
    prompt = PromptRepository(session).add(
        models.Prompt(
            user_id=user_id,
            name=payload.name,
            description=payload.description,
            context=payload.context,
            source=PromptSource.USER,
            current_version=1,
        )
    )
    PromptVersionRepository(session).add(
        models.PromptVersion(
            prompt_id=prompt.id,
            version=1,
            body=payload.body,
            system_body=payload.system_body,
            label="Migrated",
        )
    )
    return prompt


def _migrate_user_base_prompt(
    session: Session, user: models.User, shipped: models.Prompt
) -> None:
    if user.base_prompt_id is not None:
        return
    custom = (user.system_prompt_template or "").strip()
    if custom:
        entity = _create_entity(
            session,
            user.id,
            PromptCreate(
                name="Base prompt (customized)",
                description="Migrated from the account's customized chat base prompt.",
                context=PromptContext.CHAT_BASE,
                body=custom,
            ),
        )
        user.base_prompt_id = entity.id
    else:
        user.base_prompt_id = shipped.id
    user.base_prompt_version = None
    user.system_prompt_template = None
    session.add(user)
    session.flush()


def _migrate_collections(
    session: Session, user: models.User, shipped: models.Prompt
) -> None:
    statement = select(models.Collection).where(models.Collection.user_id == user.id)
    for collection in session.exec(statement).all():
        metadata = dict(collection.extra_metadata or {})
        if TOOL_PROMPT_REF_KEY in metadata:
            continue
        legacy = metadata.pop("system_prompt_template", None)
        if isinstance(legacy, str) and legacy.strip():
            entity = _create_entity(
                session,
                user.id,
                PromptCreate(
                    name=f"Tool prompt — {collection.name}",
                    description=f"Migrated from collection '{collection.name}'.",
                    context=PromptContext.CHAT_TOOL,
                    body=legacy,
                ),
            )
            target = entity
        else:
            target = shipped
        metadata[TOOL_PROMPT_REF_KEY] = {"prompt_id": str(target.id), "version": "latest"}
        collection.extra_metadata = metadata
        session.add(collection)
    session.flush()


def _shipped_body_index(
    session: Session, user_id: UUID
) -> dict[tuple[str, str | None], models.Prompt]:
    """Map shipped (body, system_body) pairs to the user's shipped rows."""
    repo = PromptRepository(session)
    index: dict[tuple[str, str | None], models.Prompt] = {}
    for spec in shipped_prompt_specs():
        prompt = repo.get_by_shipped_key(user_id, spec.key)
        if prompt is not None:
            index[(spec.body, spec.system_body)] = prompt
    return index


def _migrate_pipelines(session: Session, user: models.User) -> None:
    shipped_bodies = _shipped_body_index(session, user.id)
    statement = select(models.Pipeline).where(models.Pipeline.user_id == user.id)
    for pipeline in session.exec(statement).all():
        versions = select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline.id
        )
        for version_row in session.exec(versions).all():
            is_current = version_row.version == pipeline.current_version
            definition = _migrated_definition(
                session,
                user,
                pipeline,
                dict(version_row.definition),
                entity_refs=is_current,
                shipped_bodies=shipped_bodies,
            )
            if definition is not None:
                version_row.definition = definition
                session.add(version_row)
    session.flush()


def _migrated_definition(
    session: Session,
    user: models.User,
    pipeline: models.Pipeline,
    definition: dict[str, object],
    *,
    entity_refs: bool,
    shipped_bodies: dict[tuple[str, str | None], models.Prompt],
) -> dict[str, object] | None:
    nodes = definition.get("nodes")
    if not isinstance(nodes, list):
        return None
    changed = False
    new_nodes: list[object] = []
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") not in _NODE_CONTEXTS:
            new_nodes.append(node)
            continue
        config = dict(node.get("config") or {})
        if NODE_PROMPT_REF_KEY in config:
            new_nodes.append(node)
            continue
        prompt_text = config.get("prompt")
        system_text = config.get("system_prompt")
        body = rewrite_legacy_grammar(prompt_text) if isinstance(prompt_text, str) else ""
        system = rewrite_legacy_grammar(system_text) if isinstance(system_text, str) else ""
        if body != (prompt_text or ""):
            config["prompt"] = body
            changed = True
        if system != (system_text or ""):
            config["system_prompt"] = system
            changed = True
        if entity_refs and body.strip():
            target = shipped_bodies.get((body, system or None))
            if target is None:
                node_id = str(node.get("id", "node"))
                target = _create_entity(
                    session,
                    user.id,
                    PromptCreate(
                        name=f"{pipeline.name} — {node_id}",
                        description=f"Migrated from pipeline '{pipeline.name}'.",
                        context=_NODE_CONTEXTS[str(node.get("type"))],
                        body=body,
                        system_body=system or None,
                    ),
                )
            config[NODE_PROMPT_REF_KEY] = {
                "prompt_id": str(target.id),
                "version": "latest",
            }
            config["prompt"] = ""
            config["system_prompt"] = ""
            changed = True
        new_nodes.append({**node, "config": config})
    if not changed:
        return None
    return {**definition, "nodes": new_nodes}
