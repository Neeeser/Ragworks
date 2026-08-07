"""A retrieval pipeline whose LLM step fails, and an eval run scored on it.

The state the degraded node status exists for: the generator passes the
original query through, so search returns results and the eval run scores
every query — and nothing in those numbers says a step never executed. Here
the node run, its pipeline run, the eval run, and every query in it all
report degraded.
"""

from __future__ import annotations

from sandbox.builders import degrade_retrieval_with_llm_node, seed_degraded_eval_run
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.evals_ready import seed as seed_evals_ready


@scenario(
    name="degraded-node",
    description="evals-ready plus a retrieval pipeline whose HyDE generator can never succeed — searches and eval runs complete with degraded nodes instead of reporting success.",
    requires=("openrouter",),
    state=(
        "everything from evals-ready",
        "the collection's search pipeline carries a HyDE generator on a model no "
        "provider serves, so every query degrades on that node and retrieves the "
        "original query text",
        'eval run "Degraded HyDE run" (completed): all 3 queries scored, all 3 '
        "flagged degraded, with the run row and its alert reading Degraded",
        "a query's trace reads 'Completed with degraded nodes' with an amber "
        "Degraded badge on the HyDE node",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose evals-ready, break the LLM node, then score a run through it."""
    seed_evals_ready(ctx)
    degrade_retrieval_with_llm_node(ctx)
    seed_degraded_eval_run(ctx)
