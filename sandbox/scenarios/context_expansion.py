"""A collection whose chunks have neighbours worth expanding into.

Context expansion needs something every other scenario's corpus lacks: a
document long enough to chunk several times, chunked small enough that one
chunk is genuinely too narrow to answer from. Both are set up here — a
sectioned technical report ingested through a chunker narrowed to 160
tokens — so a query lands on a chunk whose answer is spread across the
chunks either side of it.
"""

from __future__ import annotations

from sandbox.builders import (
    LONG_DOCUMENT,
    add_context_expansion_pipeline,
    ingest_assets,
    narrow_ingestion_chunks,
)
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios import collection_ready


@scenario(
    name="context-expansion",
    description=(
        "collection-ready plus a long, finely chunked document and a retrieval "
        "pipeline that expands each match to its neighbouring chunks — the "
        "state the Expand Context node runs against."
    ),
    requires=("openrouter",),
    state=(
        "everything from collection-ready (admin user, OpenRouter connection, "
        "hybrid pipelines, 3 ingested documents)",
        "the default ingestion pipeline chunks at 160 tokens (+20 overlap), so "
        "a single chunk is too narrow to answer from",
        'document "meridian-survey.md": a sectioned technical report ingested '
        "at that size into many chunks — the only multi-chunk document in the "
        "catalog, and the one chunk adjacency is visible in",
        'search tool "Expanded Context Retrieval" (unbound): the default '
        "plus an Expand Context node in window mode, ±2 chunks",
        "the editor's Run panel is where the expansion is read: its trace states "
        "matches in, expanded items out, and how many merged",
        "switching that node to parent mode replaces each match with the whole "
        "survey instead — the same run, one item out",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed collection-ready, narrow the chunker, then ingest the long report."""
    collection_ready.seed(ctx)
    narrow_ingestion_chunks(ctx)
    ingest_assets(ctx, filenames=(LONG_DOCUMENT,))
    add_context_expansion_pipeline(ctx)
