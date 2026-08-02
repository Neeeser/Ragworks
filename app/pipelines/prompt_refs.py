"""Resolving `prompt_ref` node configs into concrete template text.

Stored definitions carry `{prompt_id, version|"latest"}` references, never
raw prompt text; this module rewrites a definition's LLM node configs with
the referenced bodies right before validation or execution — the same
resolve-then-run shape as `$expr` evaluation. It reads through the prompt
repositories (db layer) because the engine may not import services.

Legacy inline text (a historical pipeline version saved before references
existed) stays valid: a config with no `prompt_ref` is left untouched.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db.repositories.prompt import PromptRepository, PromptVersionRepository
from app.pipelines.definition import PipelineDefinition
from app.schemas.prompts import PromptReference

#: Node config key holding an LLM node's prompt reference. Mirrored by
#: `app/services/prompts/usage.py`, which owns the usage-scan side.
NODE_PROMPT_REF_KEY = "prompt_ref"


class PromptRefError(ValueError):
    """A reference names a prompt or version that does not exist."""

    def __init__(self, node_id: str, message: str) -> None:
        self.node_id = node_id
        super().__init__(message)


def parse_node_reference(config: dict[str, object]) -> PromptReference | None:
    """Parse a node config's reference; absent or malformed returns None."""
    raw = config.get(NODE_PROMPT_REF_KEY)
    if not isinstance(raw, dict):
        return None
    try:
        return PromptReference.model_validate(raw)
    except ValueError:
        return None


def resolve_prompt_references(
    session: Session,
    user_id: UUID,
    definition: PipelineDefinition,
) -> tuple[PipelineDefinition, list[dict[str, object]]]:
    """Rewrite every referenced node config with resolved template text.

    Returns the rewritten definition plus the run's prompt provenance —
    one `{node_id, prompt_id, version}` entry per resolved reference, with
    `latest` pinned to the concrete version it resolved to.
    """
    prompts = PromptRepository(session)
    versions = PromptVersionRepository(session)
    provenance: list[dict[str, object]] = []
    changed = False
    nodes = []
    for node in definition.nodes:
        reference = parse_node_reference(node.config)
        if reference is None:
            nodes.append(node)
            continue
        prompt = prompts.get(reference.prompt_id, user_id)
        if prompt is None:
            raise PromptRefError(
                node.id,
                f"Node '{node.id}' references a prompt that no longer exists.",
            )
        concrete = (
            prompt.current_version if reference.version == "latest" else int(reference.version)
        )
        row = versions.get_by_version(prompt.id, concrete)
        if row is None:
            raise PromptRefError(
                node.id,
                f"Node '{node.id}' references version {concrete} of prompt "
                f"'{prompt.name}', which does not exist.",
            )
        config = dict(node.config)
        config["prompt"] = row.body
        config["system_prompt"] = row.system_body or ""
        nodes.append(node.model_copy(update={"config": config}))
        provenance.append(
            {"node_id": node.id, "prompt_id": str(prompt.id), "version": concrete}
        )
        changed = True
    if not changed:
        return definition, provenance
    return definition.model_copy(update={"nodes": nodes}), provenance
