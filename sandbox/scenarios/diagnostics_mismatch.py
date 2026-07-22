"""A collection whose ingestion and retrieval embed with different models.

Builds on `collection-ready` (real ingested documents), then re-points the
retrieval pipeline at a *different* embedding model. This is the state the
collection-diagnostics feature exists for: the embedding-mismatch diagnostic
fires, and a real search fails at the retriever (query embedded at the wrong
dimension) — exercising the trace-backed failure path too.
"""

from __future__ import annotations

from sandbox.builders import repoint_retrieval_embedding
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios import collection_ready

# A real OpenRouter embedding model that differs from the sandbox default
# (`openai/text-embedding-3-small`, 1536d) in both name and dimension (3072d),
# so retrieval genuinely fails against the 1536d index.
DIVERGENT_EMBEDDING_MODEL = "openai/text-embedding-3-large"


@scenario(
    name="diagnostics-mismatch",
    description=(
        "collection-ready, then retrieval re-pointed at a different embedding model: "
        "the embedding_model_mismatch diagnostic fires and search fails with a "
        "trace-linked error."
    ),
    requires=("openrouter",),
    state=(
        "everything from collection-ready (admin user, OpenRouter connection, "
        "hybrid pipelines, 3 ingested documents)",
        "retrieval re-pointed at openai/text-embedding-3-large while ingestion "
        "indexed with openai/text-embedding-3-small",
        "the Diagnostics tab shows an embedding_model_mismatch error and the "
        "Overview widget reads inconsistent",
        "a search fails at the retriever with a dimension mismatch, linking to its "
        "run trace",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed collection-ready, then introduce the embedding-model drift."""
    collection_ready.seed(ctx)
    repoint_retrieval_embedding(ctx, embedding_model=DIVERGENT_EMBEDDING_MODEL)
