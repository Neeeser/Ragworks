"""Two collections on two stores, via copied pipelines.

A pipeline names the index it uses, and collections are separated inside one
index by namespace — so most collections need no index decision at all. When
one genuinely must write elsewhere, the answer is another pipeline: copy the
graph and repoint its store nodes. This is that state, and what the index
registry's "used by" list reports against.
"""

from __future__ import annotations

from sandbox.builders import add_second_collection_on_copied_pipelines
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios import collection_ready


@scenario(
    name="shared-pipelines",
    description=(
        "collection-ready plus a second collection bound to *copies* of its "
        "pipelines, writing to its own dense + BM25 indexes — the state a "
        "pipeline copy exists to produce."
    ),
    requires=("openrouter",),
    state=(
        "everything from collection-ready (admin user, OpenRouter connection, "
        "hybrid pipelines, 3 ingested documents)",
        'a second collection "Second Collection" bound to *copies* of the '
        "ingest and tool pipelines, with no documents of its own",
        "indexes second-index (dense) and second-index-bm25 (sparse), registered "
        "and named by the copied pipelines' store nodes",
        "the index registry lists four registered indexes and reports which "
        "collections use each",
        "the copied search tool declares the tool name 'search_second', "
        "so it and the original can both be bound to one collection",
        "editing the original pipelines changes only the first collection — the "
        "copies are independent graphs",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed collection-ready, expose index slots, then attach a second collection."""
    collection_ready.seed(ctx)
    add_second_collection_on_copied_pipelines(ctx)
