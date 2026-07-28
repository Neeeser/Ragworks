"""Schema v3 -> v4 upgrade: rebase chunk sizes onto additive overlap."""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition

CHUNKER_PREFIX = "chunker."


def rebase_chunk_windows(definition: PipelineDefinition) -> PipelineDefinition:
    """Rebase chunk sizes for additive overlap (schema v3 -> v4).

    `chunk_size` used to be the whole emitted window with `overlap` carved out
    of it; it is now the new document text per chunk, with `overlap` added on
    top. The same stored pair therefore describes a larger chunk than it used
    to — a 496/99 node meant 496-token chunks and would now mean 595, which
    overflows the very embedding limits those numbers were chosen to fit.

    Subtracting the overlap preserves the emitted window exactly, so existing
    collections keep chunking the way the vectors already in their indexes were
    produced. Gated by the stored `schema_version`, never re-run: rebasing
    twice would shrink every window again on the next boot.
    """
    nodes: list[PipelineNodeDefinition] = []
    for node in definition.nodes:
        config = node.config or {}
        size = config.get("chunk_size")
        overlap = config.get("chunk_overlap")
        # An expression-tagged value resolves per run, so there is no literal
        # to rebase. bool is excluded because it is an int.
        if (
            not node.type.startswith(CHUNKER_PREFIX)
            or not isinstance(size, int)
            or isinstance(size, bool)
            or not isinstance(overlap, int)
            or isinstance(overlap, bool)
            or overlap <= 0
        ):
            nodes.append(node)
            continue
        # Keep the size positive: a stored overlap at or above the size cannot
        # be rebased without inverting it, so pin the size at 1 and let the
        # window shrink rather than emitting a size the chunker rejects.
        nodes.append(
            node.model_copy(update={"config": {**config, "chunk_size": max(1, size - overlap)}})
        )
    return definition.model_copy(update={"nodes": nodes})
