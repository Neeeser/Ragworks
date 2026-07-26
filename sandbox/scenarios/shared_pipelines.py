"""Two collections sharing one pair of pipelines, on different indexes.

The state first-class index entities exist for. Before binding variables, the
only way to give a second collection its own index was to copy the pipeline,
so every later pipeline edit had to be repeated per copy. Here both
collections resolve from the same stored definitions and differ only in the
index each binding selects — which is what the Indexes control on a tool
binding edits, and what the Index Manager's "used by" list reports.
"""

from __future__ import annotations

from sandbox.builders import add_second_collection_sharing_pipelines
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
        'a second collection "Second Collection" bound to the *same* ingest and '
        "tool pipelines, with no documents of its own",
        "indexes second-index (dense) and second-index-bm25 (sparse), registered "
        "and selected by the second collection's bindings",
        "the Index Manager lists four registered indexes and reports which "
        "collections use each",
        "editing either pipeline changes both collections; changing a binding's "
        "index changes only that collection",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed collection-ready, then attach a second collection to its pipelines."""
    collection_ready.seed(ctx)
    add_second_collection_sharing_pipelines(ctx)
