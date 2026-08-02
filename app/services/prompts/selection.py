"""Resolving and setting the chat consumers' prompt references.

The chat base prompt lives on `User.base_prompt_id`/`base_prompt_version`;
a collection's tool prompt lives under `tool_prompt_ref` in its
`extra_metadata`. Both resolve here — reference first, legacy inline
template second (rows the migration has not touched yet), shipped default
constant last — so a chat turn always has a template.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import PromptRepository, PromptVersionRepository
from app.prompting import catalog_for
from app.schemas.enums import PromptContext
from app.schemas.prompts import (
    PromptRead,
    PromptReference,
    PromptSelectionRead,
    PromptVersionSelector,
)
from app.services.prompts.templates import (
    DEFAULT_BASE_PROMPT_TEMPLATE,
    DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    SYSTEM_PROMPT_METADATA_KEY,
)
from app.services.prompts.usage import TOOL_PROMPT_REF_KEY, parse_reference


def _resolve_reference(
    session: Session,
    user_id: UUID,
    reference: PromptReference,
) -> str | None:
    """Return the referenced body, or None when the reference dangles."""
    prompt = PromptRepository(session).get(reference.prompt_id, user_id)
    if prompt is None:
        return None
    version = (
        prompt.current_version
        if reference.version == "latest"
        else int(reference.version)
    )
    row = PromptVersionRepository(session).get_by_version(prompt.id, version)
    return row.body if row is not None else None


def resolve_base_prompt(
    session: Session, user: models.User
) -> tuple[str, PromptReference | None]:
    """Return the user's base prompt template and the reference it came from."""
    if user.base_prompt_id is not None:
        selector: PromptVersionSelector = (
            user.base_prompt_version if user.base_prompt_version is not None else "latest"
        )
        reference = PromptReference(prompt_id=user.base_prompt_id, version=selector)
        body = _resolve_reference(session, user.id, reference)
        if body is not None:
            return body, reference
    legacy = (user.system_prompt_template or "").strip()
    if legacy:
        return legacy, None
    return DEFAULT_BASE_PROMPT_TEMPLATE, None


def resolve_collection_prompt(
    session: Session, collection: models.Collection
) -> tuple[str, PromptReference | None]:
    """Return a collection's tool prompt template and its reference."""
    metadata = collection.extra_metadata or {}
    reference = parse_reference(metadata.get(TOOL_PROMPT_REF_KEY))
    if reference is not None:
        body = _resolve_reference(session, collection.user_id, reference)
        if body is not None:
            return body, reference
    legacy = metadata.get(SYSTEM_PROMPT_METADATA_KEY)
    if isinstance(legacy, str) and legacy.strip():
        return legacy, None
    return DEFAULT_SYSTEM_PROMPT_TEMPLATE, None


def set_base_prompt(
    session: Session, user: models.User, reference: PromptReference
) -> None:
    """Point the user's base prompt at a library prompt."""
    _require_prompt(session, user.id, reference)
    user.base_prompt_id = reference.prompt_id
    user.base_prompt_version = (
        None if reference.version == "latest" else int(reference.version)
    )
    user.system_prompt_template = None
    session.add(user)
    session.flush()


def set_collection_prompt(
    session: Session, collection: models.Collection, reference: PromptReference
) -> None:
    """Point a collection's tool prompt at a library prompt.

    Rebuilds the metadata dict rather than mutating: JSON columns are not
    `MutableDict`-wrapped, so in-place writes are never persisted.
    """
    _require_prompt(session, collection.user_id, reference)
    metadata = {
        key: value
        for key, value in (collection.extra_metadata or {}).items()
        if key != SYSTEM_PROMPT_METADATA_KEY
    }
    metadata[TOOL_PROMPT_REF_KEY] = {
        "prompt_id": str(reference.prompt_id),
        "version": reference.version,
    }
    collection.extra_metadata = metadata
    session.add(collection)
    session.flush()


def base_prompt_selection(session: Session, user: models.User) -> PromptSelectionRead:
    """Build the chat base prompt's selection read (reference + rendering)."""
    from app.services.prompts.context import base_prompt_context
    from app.services.prompts.render import apply_prompt_template

    body, reference = resolve_base_prompt(session, user)
    context = base_prompt_context(user)
    return PromptSelectionRead(
        reference=reference,
        prompt=selection_prompt_read(session, user.id, reference),
        body=body,
        rendered=apply_prompt_template(body, context),
        context=context,
        variables=list(catalog_for(PromptContext.CHAT_BASE).variables),
    )


def selection_prompt_read(
    session: Session, user_id: UUID, reference: PromptReference | None
) -> PromptRead | None:
    """Return the referenced prompt's read model, or None when absent."""
    if reference is None:
        return None
    prompt = PromptRepository(session).get(reference.prompt_id, user_id)
    if prompt is None:
        return None
    return PromptRead.model_validate(prompt, from_attributes=True)


def _require_prompt(session: Session, user_id: UUID, reference: PromptReference) -> None:
    from app.services.prompts.library import PromptLibraryService

    PromptLibraryService(session).resolve(user_id, reference.prompt_id, reference.version)
