"""A/B a prompt's versions by evaluating the pipeline that runs it.

A prompt diff says what changed; only a run says whether it helped. This
starts two eval runs over one dataset that differ in exactly one thing —
which version of one prompt the pipeline's nodes resolve to.

The two runs execute *pipelines*, not an override applied at run time: a
run whose behaviour is not written down in the definition it names cannot
be read back afterwards, and an eval result outlives the request that
produced it. So each side gets a real pipeline whose nodes pin the version
under test, named after what it pins.
"""

from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.pipelines.definition import PipelineDefinition
from app.schemas.evals import EvalRunCreate, PromptComparisonRequest
from app.schemas.prompts import PromptVersionSelector
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipelines import PipelineService
from app.services.prompts.library import PromptLibraryService
from app.services.prompts.usage import NODE_PROMPT_REF_KEY, parse_reference

#: The eval service's run creator, injected so this module orchestrates
#: without importing the service that imports it back.
RunStarter = Callable[[models.User, EvalRunCreate], models.EvalRun]


def compare_prompt_versions(
    session: Session,
    user: models.User,
    payload: PromptComparisonRequest,
    *,
    start_run: RunStarter,
) -> list[models.EvalRun]:
    """Start one eval run per version, over pinned copies of the pipeline."""
    prompt, versions = _resolve_versions(session, user, payload)
    pipelines = PipelineService(session)
    source = pipelines.get_pipeline(payload.retrieval_pipeline_id, user.id)
    if source is None:
        raise NotFoundError("Pipeline not found")
    definition = pipelines.get_definition(source)
    node_ids = _nodes_referencing(definition, prompt.id)
    if not node_ids:
        raise InvalidInputError(
            f"{source.name} has no node that uses {prompt.name}, so pinning a "
            "version of it would change nothing."
        )

    runs: list[models.EvalRun] = []
    for version in versions:
        pinned = pipelines.create_pipeline(
            user=user,
            name=f"{source.name} @ {prompt.name} v{version}",
            description=(
                f"Copy of {source.name} pinned to {prompt.name} v{version} for a "
                "prompt comparison."
            ),
            definition=_pin_version(definition, node_ids, version),
        )
        runs.append(
            start_run(
                user,
                EvalRunCreate(
                    dataset_id=payload.dataset_id,
                    ingestion_pipeline_id=payload.ingestion_pipeline_id,
                    retrieval_pipeline_id=pinned.id,
                    name=f"{prompt.name} v{version}",
                    config=payload.config,
                ),
            )
        )
    return runs


def _resolve_versions(
    session: Session, user: models.User, payload: PromptComparisonRequest
) -> tuple[models.Prompt, list[int]]:
    """The prompt and the two distinct versions to pin, or a domain error."""
    library = PromptLibraryService(session)
    prompt = library.get(user.id, payload.prompt_id)
    if payload.version_a == payload.version_b:
        raise InvalidInputError("Pick two different versions to compare.")
    available = {version.version for version in library.list_versions(user.id, prompt.id)}
    requested = [payload.version_a, payload.version_b]
    missing = [version for version in requested if version not in available]
    if missing:
        known = ", ".join(f"v{number}" for number in sorted(available))
        raise NotFoundError(f"{prompt.name} has no version {missing[0]} — it has {known}.")
    return prompt, requested


def _nodes_referencing(definition: PipelineDefinition, prompt_id: UUID) -> list[str]:
    """Ids of the nodes whose prompt reference names this prompt."""
    node_ids: list[str] = []
    for node in definition.nodes:
        reference = parse_reference((node.config or {}).get(NODE_PROMPT_REF_KEY))
        if reference is not None and reference.prompt_id == prompt_id:
            node_ids.append(node.id)
    return node_ids


def _pin_version(
    definition: PipelineDefinition, node_ids: list[str], version: PromptVersionSelector
) -> PipelineDefinition:
    """The definition with those nodes' references pinned to one version."""
    raw: dict[str, Any] = copy.deepcopy(definition.model_dump(mode="json"))
    for node in raw.get("nodes", []):
        if not isinstance(node, dict) or str(node.get("id")) not in node_ids:
            continue
        config = node.setdefault("config", {})
        reference = config.get(NODE_PROMPT_REF_KEY)
        if isinstance(reference, dict):
            config[NODE_PROMPT_REF_KEY] = {**reference, "version": version}
    return PipelineDefinition.model_validate(raw)
