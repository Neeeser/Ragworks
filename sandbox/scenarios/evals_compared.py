"""Two eval runs over one dataset, differing only in the search tool.

The state the comparison view reads: change one thing, re-run, compare. Same
dataset, same corpus, same sample — one run scored through the bound hybrid
tool, the other through a dense-only copy of it.
"""

from __future__ import annotations

from sandbox.builders import add_alternate_search_pipeline, seed_comparable_eval_runs
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.evals_ready import seed as seed_evals_ready


@scenario(
    name="evals-compared",
    description=(
        "evals-ready plus a dense-only copy of the search tool and one completed "
        "eval run through each — the pair the run comparison view diffs."
    ),
    requires=("openrouter",),
    state=(
        "everything from evals-ready",
        'a search tool "Dense-Only Retrieval": a copy of the default with the '
        "BM25 retriever and RRF fusion removed, bound to no collection",
        'eval run "Hybrid baseline" (completed): 3 queries scored through the '
        "bound hybrid search tool",
        'eval run "Dense-only variant" (completed): the same 3 queries scored '
        "through the dense-only copy",
        "the two runs differ in exactly one configuration field, so their "
        "comparison reads as a search-tool change and nothing else",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose evals-ready, add the dense-only copy, score a run through each."""
    seed_evals_ready(ctx)
    alternate = add_alternate_search_pipeline(ctx)
    seed_comparable_eval_runs(ctx, alternate.id)
