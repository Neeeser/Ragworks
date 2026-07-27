"""Both vector-store backends registered, so a binding can be swapped.

The capability check only has something to say when an index on a *different*
backend is genuinely selectable, so this scenario registers a Pinecone index
beside the pgvector ones. Pointing an ordinary hybrid pipeline at either is
fine; pointing a count or facet pipeline at Pinecone is refused, because
Pinecone has no query-conditioned aggregation plane to answer them.
"""

from __future__ import annotations

from sandbox.builders import add_pinecone_index, add_provider_connection
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios import shared_pipelines


@scenario(
    name="backend-swap",
    description=(
        "shared-pipelines plus a Pinecone connection and registered index: both "
        "backends are selectable, so binding-index swaps and the count/facet "
        "capability refusals can be exercised for real."
    ),
    requires=("openrouter", "pinecone"),
    state=(
        "everything from shared-pipelines (two collections sharing one pipeline "
        "pair on their own pgvector indexes)",
        "a live-validated Pinecone connection",
        "registered Pinecone indexes sandbox-remote (dense, sized to the "
        "embedding model) and sandbox-remote-bm25 (sparse) — both planes, so a "
        "lexical slot can be pointed at Pinecone and refused on capability "
        "rather than on vector type",
        "a tool binding can be repointed from pgvector to Pinecone from the "
        "collection's Indexes control",
        "a count or facet pipeline is refused on Pinecone, naming the nodes that "
        "cannot run there",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed shared-pipelines, then add the second backend."""
    shared_pipelines.seed(ctx)
    add_provider_connection(ctx, "pinecone")
    add_pinecone_index(ctx)
