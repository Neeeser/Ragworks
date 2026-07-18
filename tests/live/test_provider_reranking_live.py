"""Explicitly selected smoke test for complete provider reranking."""

from __future__ import annotations

import pytest

from scripts.smoke_provider_reranking import live_target_from_environment, run_live_smoke


@pytest.mark.live_provider_reranking
def test_provider_reranker_preserves_every_candidate_before_result_limit(
    pytestconfig: pytest.Config,
) -> None:
    """The real adapter and node path preserve ranked candidates before the final cut."""
    target = live_target_from_environment(pytestconfig.getoption("--provider-reranking-provider"))
    assert target is not None
    result = run_live_smoke(target)
    assert result.reranked_count > result.result_limit
    assert result.limited_count == result.result_limit
