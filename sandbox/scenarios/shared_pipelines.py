"""Two collections sharing one pair of pipelines, on different indexes.

The state index slots exist for. A pipeline names its own index, which is
what most collections want — they are separated by namespace inside it. When
one definition must instead serve collections on *different* stores, its
author exposes the index as a slot, and each collection answers it. Both
collections here resolve from the same stored definitions and differ only in
the index their binding selects, which is what the collection's Indexes
control edits and what the index registry's "used by" list reports.
"""

from __future__ import annotations

from sandbox.builders import (
    add_second_collection_sharing_pipelines,
    expose_pipeline_index_slots,
)
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios import collection_ready


@scenario(
    name="shared-pipelines",
    description=(
        "collection-ready plus a second collection bound to the same pipelines on "
        "its own dense + BM25 indexes: the modular-pipeline state, where one "
        "definition serves two collections."
    ),
    requires=("openrouter",),
    state=(
        "everything from collection-ready (admin user, OpenRouter connection, "
        "hybrid pipelines, 3 ingested documents)",
        "the default pipelines expose their indexes as the per-collection slots "
        "primary_index and bm25_index",
        'a second collection "Second Collection" bound to the *same* ingest and '
        "tool pipelines, with no documents of its own",
        "indexes second-index (dense) and second-index-bm25 (sparse), registered "
        "and selected by the second collection's bindings",
        "the index registry lists four registered indexes and reports which "
        "collections use each",
        "editing either pipeline changes both collections; changing a binding's "
        "index changes only that collection",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed collection-ready, expose index slots, then attach a second collection."""
    collection_ready.seed(ctx)
    expose_pipeline_index_slots(ctx)
    add_second_collection_sharing_pipelines(ctx)
