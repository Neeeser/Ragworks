"""A completed eval run whose corpus lost a document to ingestion."""

from __future__ import annotations

from sandbox.builders import seed_eval_run_with_unindexed_corpus_doc
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.evals_ready import seed as seed_evals_ready


@scenario(
    name="evals-corpus-gap",
    description="evals-ready plus a completed eval run whose corpus holds one document that failed to index — the state the corpus retry action repairs.",
    requires=("openrouter",),
    state=(
        "everything from evals-ready",
        'eval dataset "Corpus with a failed document": 3 queries, one whose gold '
        "document carries no text and cannot be chunked",
        "a completed eval run over it: 2 of 3 corpus documents indexed, 1 query "
        "recorded unscored, aggregates covering the other 2",
        "the run page and the dataset's corpora pane both offer 'Retry failed documents'",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose evals-ready, then run an eval over a corpus with a bad document."""
    seed_evals_ready(ctx)
    seed_eval_run_with_unindexed_corpus_doc(ctx)
