"""Fetch-depth resolution for eval queries.

Metrics are document-level while retrieval returns chunks, and metrics truncate
at each cutoff `k` themselves — so the per-query fetch depth must always cover
the deepest configured cutoff, over-fetch chunks so document dedup can still
fill it, and stay within the pipeline's own declared depth-variable maxima.
"""

from __future__ import annotations

import logging

from app.pipelines.definition import PipelineDefinition
from app.schemas.evals import EvalRunConfig

logger = logging.getLogger(__name__)

# Document-level metrics over chunk-level retrieval: fetch several chunks per
# requested document rank so dedup still fills the deepest cutoff, capped so a
# large k_values entry cannot demand an absurd fetch.
_CHUNK_OVERFETCH = 4
_MAX_TOP_K = 200

# Variable names that bind a retrieval depth, mirroring the frontend's
# depth-variable matcher (`frontend/src/components/evals/lib/run-config.ts`).
DEPTH_VARIABLE_NAMES = frozenset({"result_limit", "top_k", "limit", "max_results", "depth"})


def effective_top_k(config: EvalRunConfig, depth_cap: int | None = None) -> int:
    """Chunks to fetch per query: enough for the deepest cutoff, over-fetched.

    Two fairness rules. An explicit `run_inputs` top_k is a floor, never a
    truncation below the deepest cutoff — otherwise top_k=5 with k_values
    [10, 25] silently scores recall@25 against a 5-result list. And because
    metrics are document-level while retrieval returns chunks, the fetch is
    over-fetched (`_CHUNK_OVERFETCH`) so a small-chunk pipeline whose top-k
    chunks collapse onto a few documents is not understated at deep cutoffs
    relative to a coarse-chunk pipeline. `depth_cap` is the pipeline's own
    declared maximum for its result-limit variable: the pipeline rejects
    anything above it, so it bounds everything (the caller warns when the
    cap truncates below the deepest cutoff).
    """
    deepest = max(config.k_values) if config.k_values else 10
    explicit = config.run_inputs.get("top_k")
    floor = deepest
    if isinstance(explicit, int) and explicit > 0:
        floor = max(explicit, deepest)
    desired = max(floor, min(deepest * _CHUNK_OVERFETCH, _MAX_TOP_K))
    if depth_cap is not None:
        return min(desired, depth_cap)
    return desired


def depth_caps(definition: PipelineDefinition | None) -> dict[str, int]:
    """Read the maxima of the pipeline's declared depth variables, by name.

    The pipeline validates bound arguments against each variable's declared
    maximum, so a fetch depth above it is rejected outright — the caps are the
    hard ceiling the evaluation must stay within.
    """
    if definition is None:
        return {}
    return {
        variable.name: int(variable.maximum)
        for variable in definition.variables
        if variable.name in DEPTH_VARIABLE_NAMES and variable.maximum is not None
    }


def raise_bound_depths(
    config: EvalRunConfig, top_k: int, caps: dict[str, int]
) -> EvalRunConfig:
    """Raise bound depth variables to the evaluation fetch depth.

    A bound depth variable smaller than the fetch depth would truncate inside
    the pipeline regardless of the query's top_k parameter, silently scoring
    deep cutoffs against a short list. Each raise still honors the variable's
    own declared maximum.
    """
    run_inputs = dict(config.run_inputs)
    changed = False
    for name, value in run_inputs.items():
        if name not in DEPTH_VARIABLE_NAMES or not isinstance(value, int):
            continue
        target = min(top_k, caps.get(name, top_k))
        if 0 < value < target:
            logger.info(
                "Raising bound depth variable %r from %s to %s to cover the "
                "deepest configured cutoff.",
                name,
                value,
                target,
            )
            run_inputs[name] = target
            changed = True
    if not changed:
        return config
    return config.model_copy(update={"run_inputs": run_inputs})
