"""A hundred-document corpus for exercising the insights surface at scale."""

from __future__ import annotations

from sandbox.builders import (
    add_openrouter_connection,
    bootstrap_setup,
    compute_insights,
    create_admin_user,
    create_pgvector_index,
    ingest_generated_documents,
)
from sandbox.context import SeedContext
from sandbox.registry import scenario

# Small and cheap: ~100 documents embed for fractions of a cent, and its
# short input limit makes the chunker split every document into several
# chunks — the shape the insight views exist to show.
EMBEDDING_MODEL = "sentence-transformers/all-minilm-l6-v2"


@scenario(
    name="insights-corpus",
    description=(
        "collection-ready's wizard path with a ~100-document, multi-chunk corpus "
        "built from 20 newsgroups and embedded with MiniLM — the Visualize page "
        "shows real clusters, document ties, and cross-document overlaps."
    ),
    requires=("openrouter",),
    state=(
        "one admin user (the standard sandbox login)",
        "a live-validated OpenRouter connection (embeddings + chat)",
        "a pgvector dense index sized to all-minilm-l6-v2 (384d)",
        "hybrid ingestion pipeline + search tool (dense + BM25, RRF-fused)",
        'collection "Insights Corpus": ~100 ready documents from 8 newsgroup '
        "topics, several chunks each (hundreds of chunks total)",
        "a ready insight snapshot: PaCMAP map with labelled clusters, document "
        "graph edges, and a populated overlap report",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Wizard path on MiniLM, then the newsgroup corpus and one snapshot."""
    from sandbox.corpus import build_corpus

    create_admin_user(ctx)
    add_openrouter_connection(ctx)
    index_name, dimension = create_pgvector_index(ctx, embedding_model=EMBEDDING_MODEL)
    bootstrap_setup(
        ctx,
        index_name=index_name,
        embedding_dimension=dimension,
        embedding_model=EMBEDDING_MODEL,
        collection_name="Insights Corpus",
    )
    corpus = build_corpus()
    ingest_generated_documents(
        ctx, documents=[(doc.filename, doc.text) for doc in corpus]
    )
    compute_insights(ctx)
