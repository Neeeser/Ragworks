"""Rewriting node-library presets onto the user's shipped library prompts.

A preset's shipped prompt text lives in the library as a `preset.<id>`
shipped prompt, so the node specs served to the editor reference it —
dropping a preset creates a node that reads the library, not a fresh
inline copy that would drift from it. A user whose shipped row is missing
(not seeded yet) keeps the inline text, which stays a valid legacy state.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db.repositories import PromptRepository
from app.schemas.pipelines import NodeSpecRead


def reference_preset_prompts(
    session: Session,
    user_id: UUID,
    nodes: list[NodeSpecRead],
) -> list[NodeSpecRead]:
    """Point every preset carrying prompt text at its shipped library prompt."""
    prompts = PromptRepository(session)
    for spec in nodes:
        for preset in spec.presets:
            body = preset.config.get("prompt")
            if not isinstance(body, str) or not body.strip():
                continue
            shipped = prompts.get_by_shipped_key(user_id, f"preset.{preset.id}")
            if shipped is None:
                continue
            preset.config = {
                **preset.config,
                "prompt_ref": {"prompt_id": str(shipped.id), "version": "latest"},
                "prompt": "",
                "system_prompt": "",
            }
    return nodes
