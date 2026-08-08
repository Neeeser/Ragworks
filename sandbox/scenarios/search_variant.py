"""A collection with a second search tool to switch to.

Switching a collection's search pipeline is a replacement, not an addition:
the incoming pipeline is a copy of the outgoing one and carries its tool name
until someone edits it, so the two can never be bound at once. This is the
state that exercise needs — an ingested collection plus one unbound
alternative whose graph the trace distinguishes from the default's.
"""

from __future__ import annotations

from sandbox.builders import add_alternate_search_pipeline
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios import collection_ready


@scenario(
    name="search-variant",
    description=(
        "collection-ready plus an unbound copy of the default search "
        "tool — dense-only, same 'search' tool name — the state switching "
        "a collection's search tool runs against."
    ),
    requires=("openrouter",),
    state=(
        "everything from collection-ready (admin user, OpenRouter connection, "
        "hybrid pipelines, 3 ingested documents)",
        'a search tool "Dense-Only Retrieval": a verbatim copy of the '
        "default with the BM25 retriever and RRF fusion removed",
        "that copy declares the same tool name ('search') as the bound default, "
        "so binding both at once is refused and switching must replace",
        "the copy is bound to no collection — the Overview's Search tool "
        "control is where it gets bound",
        "a query run after switching traces a 5-node graph, against the "
        "default's 7 — which pipeline served it is readable from the trace",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed collection-ready, then add the unbound dense-only retrieval copy."""
    collection_ready.seed(ctx)
    add_alternate_search_pipeline(ctx)
