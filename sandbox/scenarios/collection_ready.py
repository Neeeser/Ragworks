"""The wizard-complete state: a working collection with ingested documents."""

from __future__ import annotations

from sandbox.builders import (
    SAMPLE_DOCUMENTS,
    add_openrouter_connection,
    bootstrap_setup,
    create_admin_user,
    create_pgvector_index,
    ingest_assets,
)
from sandbox.context import SeedContext
from sandbox.registry import scenario


@scenario(
    name="collection-ready",
    description="Setup complete: OpenRouter connection, hybrid default pipelines, and a collection with three ingested sample documents (real chunks and vectors).",
    requires=("openrouter",),
    state=(
        "one admin user (the standard sandbox login)",
        "a live-validated OpenRouter connection (embeddings + chat)",
        "a pgvector dense index sized to the configured embedding model",
        "hybrid default ingestion + retrieval pipelines (dense + BM25, RRF-fused)",
        'collection "Sandbox Collection" with 3 ready documents (aurora-station, '
        "tidepool-protocol, glasswing-archive) — distinct topics for retrieval checks",
        "search, chat, traces, and visualizations all have real data behind them",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Run the full wizard-equivalent path, then ingest the sample documents."""
    create_admin_user(ctx)
    add_openrouter_connection(ctx)
    index_name, dimension = create_pgvector_index(ctx)
    bootstrap_setup(ctx, index_name=index_name, embedding_dimension=dimension)
    ingest_assets(ctx, filenames=SAMPLE_DOCUMENTS)
