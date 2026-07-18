"""Collection guard for explicitly selected provider reranking smoke tests."""

from __future__ import annotations

import pytest

from scripts.smoke_provider_reranking import live_target_from_environment


def pytest_addoption(parser: pytest.Parser) -> None:
    """Register the explicit switch that permits live provider requests."""
    parser.addoption(
        "--live-provider-reranking",
        action="store_true",
        default=False,
        help="run provider reranking smoke tests when their required environment is present",
    )
    parser.addoption(
        "--provider-reranking-provider",
        choices=("openrouter", "cohere"),
        default="openrouter",
        help="provider to exercise when --live-provider-reranking is selected",
    )


def pytest_configure(config: pytest.Config) -> None:
    """Register the marker even when this directory is selected directly."""
    config.addinivalue_line(
        "markers",
        "live_provider_reranking: opt-in smoke test that contacts a configured provider",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip live requests unless the command and full provider config opt in."""
    if not config.getoption("--live-provider-reranking"):
        reason = "pass --live-provider-reranking to allow provider requests"
    else:
        provider = config.getoption("--provider-reranking-provider")
        if live_target_from_environment(provider) is not None:
            return
        reason = "set the selected provider's reranking key and model environment variables"
    marker = pytest.mark.skip(reason=reason)
    for item in items:
        item.add_marker(marker)
