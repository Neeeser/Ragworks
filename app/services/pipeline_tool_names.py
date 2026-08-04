"""Tool-name collision checking for a pipeline definition save.

Split from `app/services/pipelines.py` (which owns pipeline CRUD/versioning,
already at the module-size ceiling): this is a distinct, self-contained
concern -- does *this* edit rename a bound pipeline's tool onto a sibling
tool binding's name in any collection the pipeline is bound into. The
bind-time half of the same rule lives in
`CollectionToolService._reject_duplicate_tool_name`; both go through
`ensure_unique_tool_names` (`app/services/tool_naming.py`) for the actual
comparison and error message.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.interface import PipelineInterface, derive_interface
from app.services.tool_naming import ensure_unique_tool_names, tool_base_name

if TYPE_CHECKING:
    from app.services.pipelines import PipelineService


def reject_tool_name_collision(
    service: PipelineService,
    pipeline: models.Pipeline,
    definition: PipelineDefinition,
) -> None:
    """Reject a definition edit that renames `pipeline`'s tool onto a sibling's.

    Only fires when the base tool name is actually *changing*. A collection
    may already hold a stored collision (pre-existing data from before this
    check existed -- surfaced by `DuplicateToolNameRule` rather than
    migrated), and that collision must not lock the pipeline out of every
    *other* future save; renaming away from the collision (fixing it) or
    editing an unrelated field must both keep working. The rejection only
    blocks the edit that would newly create or preserve a same-named pair by
    renaming into one.
    """
    old_base = tool_base_name(service.interface_for(pipeline))
    new_interface = derive_interface(definition)
    if not new_interface.callable:
        return
    new_base = tool_base_name(new_interface)
    if new_base == old_base:
        return
    bindings = CollectionPipelineBindingRepository(service.session)
    for binding in bindings.list_for_pipeline(pipeline.id, role=models.BindingRole.TOOL):
        siblings = bindings.list_for_collection(
            binding.collection_id, role=models.BindingRole.TOOL
        )
        pairs: list[tuple[models.Pipeline, PipelineInterface]] = [(pipeline, new_interface)]
        for sibling in siblings:
            if sibling.id == binding.id:
                continue
            sibling_pipeline = service.get_pipeline(sibling.pipeline_id, pipeline.user_id)
            if sibling_pipeline is None:
                continue
            pairs.append((sibling_pipeline, service.interface_for(sibling_pipeline)))
        ensure_unique_tool_names(pairs)
