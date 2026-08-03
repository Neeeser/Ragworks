"""Where a prompt is referenced: the "used by" scan and its conventions.

References are stored three ways — `User.base_prompt_id`, the
`tool_prompt_ref` key in collection `extra_metadata`, and `prompt_ref`
entries in pipeline node configs. This module owns those key names and
walks all three so the delete guard and the studio's usage listing agree.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlmodel import Session, col, select

from app.db import models
from app.schemas.prompts import PromptReference, PromptUsageRead, PromptVersionSelector

#: Collection `extra_metadata` key holding the tool prompt reference.
TOOL_PROMPT_REF_KEY = "tool_prompt_ref"

#: Node config key holding an LLM node's prompt reference.
NODE_PROMPT_REF_KEY = "prompt_ref"


def parse_reference(raw: object) -> PromptReference | None:
    """Parse a stored reference dict; malformed or absent returns None."""
    if not isinstance(raw, dict):
        return None
    prompt_id = raw.get("prompt_id")
    version: object = raw.get("version", "latest")
    if not isinstance(prompt_id, str):
        return None
    if not (version == "latest" or isinstance(version, int)):
        return None
    try:
        parsed = UUID(prompt_id)
    except ValueError:
        return None
    selector: PromptVersionSelector = version if isinstance(version, int) else "latest"
    return PromptReference(prompt_id=parsed, version=selector)


def definition_prompt_references(
    definition: dict[str, Any],
) -> list[tuple[str, PromptReference]]:
    """Return `(node_id, reference)` for every node config naming a prompt."""
    references: list[tuple[str, PromptReference]] = []
    for node in definition.get("nodes", []):
        if not isinstance(node, dict):
            continue
        config = node.get("config")
        if not isinstance(config, dict):
            continue
        reference = parse_reference(config.get(NODE_PROMPT_REF_KEY))
        if reference is not None:
            references.append((str(node.get("id", "")), reference))
    return references


def prompt_usages(
    session: Session,
    user_id: UUID,
    prompt_id: UUID,
) -> list[PromptUsageRead]:
    """List every consumer of one prompt, across all reference stores."""
    usages: list[PromptUsageRead] = []
    usages.extend(_chat_base_usages(session, user_id, prompt_id))
    usages.extend(_collection_usages(session, user_id, prompt_id))
    usages.extend(_pipeline_usages(session, user_id, prompt_id))
    return usages


def usage_counts(session: Session, user_id: UUID) -> dict[UUID, int]:
    """How many consumers each of the user's prompts has, in one pass.

    The library list shows this per row, so resolving it prompt-by-prompt
    would re-read every pipeline once per prompt; the reference stores are
    walked once here instead.
    """
    counts: dict[UUID, int] = {}

    def add(prompt_id: UUID) -> None:
        counts[prompt_id] = counts.get(prompt_id, 0) + 1

    user = session.get(models.User, user_id)
    if user is not None and user.base_prompt_id is not None:
        add(user.base_prompt_id)

    collections = session.exec(
        select(models.Collection).where(col(models.Collection.user_id) == user_id)
    ).all()
    for collection in collections:
        reference = parse_reference((collection.extra_metadata or {}).get(TOOL_PROMPT_REF_KEY))
        if reference is not None:
            add(reference.prompt_id)

    for _pipeline, version_row in _current_pipeline_versions(session, user_id):
        for _node_id, reference in definition_prompt_references(version_row.definition):
            add(reference.prompt_id)
    return counts


def _current_pipeline_versions(
    session: Session, user_id: UUID
) -> list[tuple[models.Pipeline, models.PipelineVersion]]:
    """Each of the user's pipelines paired with the version it runs."""
    pairs: list[tuple[models.Pipeline, models.PipelineVersion]] = []
    pipelines = session.exec(
        select(models.Pipeline).where(col(models.Pipeline.user_id) == user_id)
    ).all()
    for pipeline in pipelines:
        version_row = session.exec(
            select(models.PipelineVersion).where(
                col(models.PipelineVersion.pipeline_id) == pipeline.id,
                col(models.PipelineVersion.version) == pipeline.current_version,
            )
        ).first()
        if version_row is not None:
            pairs.append((pipeline, version_row))
    return pairs


def _chat_base_usages(
    session: Session, user_id: UUID, prompt_id: UUID
) -> list[PromptUsageRead]:
    user = session.get(models.User, user_id)
    if user is None or user.base_prompt_id != prompt_id:
        return []
    version: PromptVersionSelector = (
        user.base_prompt_version if user.base_prompt_version is not None else "latest"
    )
    return [
        PromptUsageRead(kind="chat_base", name="Chat base prompt", id=str(user_id), version=version)
    ]


def _collection_usages(
    session: Session, user_id: UUID, prompt_id: UUID
) -> list[PromptUsageRead]:
    statement = select(models.Collection).where(col(models.Collection.user_id) == user_id)
    usages: list[PromptUsageRead] = []
    for collection in session.exec(statement).all():
        reference = parse_reference((collection.extra_metadata or {}).get(TOOL_PROMPT_REF_KEY))
        if reference is not None and reference.prompt_id == prompt_id:
            usages.append(
                PromptUsageRead(
                    kind="collection_tool",
                    name=collection.name,
                    id=str(collection.id),
                    version=reference.version,
                )
            )
    return usages


def _pipeline_usages(
    session: Session, user_id: UUID, prompt_id: UUID
) -> list[PromptUsageRead]:
    usages: list[PromptUsageRead] = []
    for pipeline, version_row in _current_pipeline_versions(session, user_id):
        for node_id, reference in definition_prompt_references(version_row.definition):
            if reference.prompt_id == prompt_id:
                usages.append(
                    PromptUsageRead(
                        kind="pipeline_node",
                        name=f"{pipeline.name} — {node_id}",
                        id=str(pipeline.id),
                        node_id=node_id,
                        pipeline_kind=_pipeline_kind(version_row.definition),
                        version=reference.version,
                    )
                )
    return usages


def _pipeline_kind(definition: dict[str, Any]) -> str:
    """Which editor section a pipeline lives in, from its boundary nodes.

    A pipeline's kind is derived from its definition rather than stored, so
    a usage link has to derive it the same way to land on the right route.
    """
    types = {node.get("type") for node in definition.get("nodes", []) if isinstance(node, dict)}
    return "ingestion" if "ingestion.input" in types else "retrieval"
