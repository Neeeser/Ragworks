"""Everything the evals page needs: collection-ready plus a ready dataset."""

from __future__ import annotations

from sandbox.builders import seed_eval_dataset
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.collection_ready import seed as seed_collection_ready


@scenario(
    name="evals-ready",
    description="collection-ready plus a ready BEIR-format eval dataset whose queries target the seeded documents — eval runs can be created immediately.",
    requires=("openrouter",),
    state=(
        "everything from collection-ready",
        'eval dataset "Sandbox Eval Dataset" (ready): 3 queries with relevance '
        "judgments against the 3 seeded sample documents",
        "creating and scoring an eval run is the remaining user action under test",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose collection-ready, then add the eval dataset."""
    seed_collection_ready(ctx)
    seed_eval_dataset(ctx)
