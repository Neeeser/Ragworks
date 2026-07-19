"""Behavior tests for the run engine's per-query fetch depth.

Metrics are document-level while retrieval returns chunks, and metrics truncate
at each cutoff `k` themselves — so the fetch depth must always cover the deepest
cutoff (an explicit bound must never silently truncate deep metrics) and
over-fetch chunks so document dedup can still fill it.
"""

from __future__ import annotations

from app.evals.execution.runner import EvalRunner
from app.schemas.evals import EvalRunConfig


def _config(**overrides: object) -> EvalRunConfig:
    base: dict[str, object] = {"num_queries": 5, "distractor_pool_size": 0}
    base.update(overrides)
    return EvalRunConfig.model_validate(base)


def test_explicit_top_k_never_truncates_below_the_deepest_cutoff() -> None:
    """top_k=5 with k_values [10, 25] must not score recall@25 on 5 results."""
    config = _config(k_values=[10, 25], run_inputs={"top_k": 5})
    assert EvalRunner._effective_top_k(config) >= 25


def test_fetch_overfetches_chunks_for_document_dedup() -> None:
    """The chunk fetch exceeds the deepest cutoff so dedup can still fill it."""
    config = _config(k_values=[1, 5, 10])
    assert EvalRunner._effective_top_k(config) == 40


def test_overfetch_is_capped() -> None:
    """A deep cutoff cannot demand an unbounded fetch."""
    config = _config(k_values=[100])
    assert EvalRunner._effective_top_k(config) == 200


def test_explicit_top_k_above_the_cutoffs_is_honored() -> None:
    """A user-bound top_k larger than any cutoff (and the cap) is kept as-is."""
    config = _config(k_values=[10], run_inputs={"top_k": 300})
    assert EvalRunner._effective_top_k(config) == 300


def test_pipeline_depth_cap_bounds_the_fetch() -> None:
    """A pipeline whose result-limit variable maxes at 10 rejects more — the
    fetch stays within it (the runner warns when that undercuts a cutoff)."""
    config = _config(k_values=[1, 5, 10])
    assert EvalRunner._effective_top_k(config, depth_cap=10) == 10


def test_bound_depth_variables_are_raised_to_the_fetch_depth() -> None:
    """A bound depth variable below the fetch depth is raised (up to its cap),
    so it cannot truncate inside the pipeline below the deepest cutoff."""
    config = _config(k_values=[10, 25], run_inputs={"result_limit": 5, "note": "x"})
    raised = EvalRunner._raise_bound_depths(
        config, top_k=40, depth_caps={"result_limit": 30}
    )
    assert raised.run_inputs == {"result_limit": 30, "note": "x"}
    # The recorded run config is immutable; raising returns a copy.
    assert config.run_inputs["result_limit"] == 5
