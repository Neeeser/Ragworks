"""Contract tests for the opt-in provider reranking smoke harness."""

import os
import subprocess
import sys
import tomllib
import traceback
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN_RUNTIME_PREFIXES = (
    "sentence-transformers",
    "transformers",
    "torch",
    "triton",
)


def _is_forbidden_runtime_package(name: str) -> bool:
    """Recognize every local transformer, NVIDIA, and CUDA package family."""
    normalized = name.casefold().replace("_", "-").replace(".", "-")
    return (
        normalized.startswith(FORBIDDEN_RUNTIME_PREFIXES)
        or normalized.startswith("nvidia-")
        or "cuda" in normalized
    )


def test_default_dependency_lock_excludes_local_transformer_runtime() -> None:
    """The shipped application must not bring a local transformer stack with it."""
    project = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    lock = tomllib.loads((ROOT / "uv.lock").read_text(encoding="utf-8"))
    direct_dependencies = {
        dependency.split("[", 1)[0].split(">", 1)[0].split("<", 1)[0].split("=", 1)[0]
        for dependency in project["project"]["dependencies"]
    }
    locked_packages = {package["name"] for package in lock["package"]}

    assert not sorted(
        package
        for package in direct_dependencies | locked_packages
        if _is_forbidden_runtime_package(package)
    )


@pytest.mark.parametrize(
    "package",
    [
        "sentence-transformers-gpu",
        "transformers-extra",
        "torchvision",
        "triton-kernels",
        "nvidia-cudnn-cu12",
        "cupy-cuda12x",
    ],
)
def test_forbidden_runtime_package_families_are_complete(package: str) -> None:
    """The dependency guard covers prefixes and vendor/runtime variants."""
    assert _is_forbidden_runtime_package(package)


def test_live_target_needs_opt_in_and_provider_environment(
    monkeypatch,
) -> None:
    """A provider request cannot be configured by ambient credentials alone."""
    from scripts import smoke_provider_reranking as smoke

    monkeypatch.setenv("OPENROUTER_API_KEY", "not-a-real-secret")
    monkeypatch.setenv("OPENROUTER_RERANK_MODEL", "cohere/rerank-v3.5")

    assert smoke.live_target_from_environment("openrouter") is None

    monkeypatch.setenv("RAGWORKS_LIVE_PROVIDER_RERANKING", "1")
    assert smoke.live_target_from_environment("openrouter") == smoke.LiveRerankingTarget(
        provider="openrouter",
        model="cohere/rerank-v3.5",
    )


def test_smoke_cli_never_echoes_a_missing_provider_secret(monkeypatch, capsys) -> None:
    """Configuration errors name only non-secret variables and never their values."""
    from scripts import smoke_provider_reranking as smoke

    secret = "do-not-print-this-value"
    monkeypatch.setenv("RAGWORKS_LIVE_PROVIDER_RERANKING", "1")
    monkeypatch.setenv("COHERE_API_KEY", secret)
    monkeypatch.delenv("COHERE_RERANK_MODEL", raising=False)

    assert smoke.main(["--live", "--provider", "cohere"]) == 2

    captured = capsys.readouterr()
    assert secret not in captured.out
    assert secret not in captured.err


def test_smoke_script_runs_its_configuration_guard_from_repo_root() -> None:
    """The documented script path must refuse a request before importing provider state."""
    environment = os.environ.copy()
    environment.pop("RAGWORKS_LIVE_PROVIDER_RERANKING", None)
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "smoke_provider_reranking.py"),
            "--live",
            "--provider",
            "openrouter",
        ],
        cwd=ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
    assert "Live reranking is not enabled" in result.stdout


def test_live_smoke_redacts_provider_failure_from_exception_trace(
    monkeypatch,
) -> None:
    """Provider details cannot escape through the direct live-test failure path."""
    from scripts import smoke_provider_reranking as smoke

    sentinel_secret = "sentinel-provider-secret"
    monkeypatch.setenv("OPENROUTER_API_KEY", "not-a-real-secret")

    def fail_adapter(_connection):
        raise RuntimeError(f"provider rejected key {sentinel_secret}")

    monkeypatch.setattr(smoke, "build_adapter", fail_adapter)

    with pytest.raises(smoke.LiveSmokeError) as exc_info:
        smoke.run_live_smoke(
            smoke.LiveRerankingTarget(provider="openrouter", model="test-reranker")
        )

    exc = exc_info.value
    rendered = "".join(traceback.TracebackException.from_exception(exc).format())
    assert sentinel_secret not in str(exc)
    assert sentinel_secret not in repr(exc)
    assert sentinel_secret not in rendered
    assert str(exc) == smoke.SAFE_SMOKE_FAILURE_MESSAGE
    assert exc.__cause__ is None
    assert exc.__context__ is None


def test_smoke_cli_redacts_provider_failure(monkeypatch, capsys) -> None:
    """The CLI emits only the fixed failure text after provider work begins."""
    from scripts import smoke_provider_reranking as smoke

    sentinel_secret = "sentinel-cli-secret"
    monkeypatch.setenv("RAGWORKS_LIVE_PROVIDER_RERANKING", "1")
    monkeypatch.setenv("OPENROUTER_API_KEY", "not-a-real-secret")
    monkeypatch.setenv("OPENROUTER_RERANK_MODEL", "test-reranker")

    def fail_adapter(_connection):
        raise RuntimeError(f"request headers contained {sentinel_secret}")

    monkeypatch.setattr(smoke, "build_adapter", fail_adapter)

    assert smoke.main(["--live", "--provider", "openrouter"]) != 0
    captured = capsys.readouterr()
    assert captured.out.strip() == smoke.SAFE_SMOKE_FAILURE_MESSAGE
    assert captured.err == ""
    assert sentinel_secret not in captured.out
    assert sentinel_secret not in captured.err


def test_live_smoke_proves_expected_candidate_ranks_first_through_node_path(
    monkeypatch,
) -> None:
    """The production adapter, resolver, context, and nodes retain provider ranking."""
    from app.clients.openrouter import OpenRouterClient
    from app.schemas.chat_completions import RerankResponse
    from scripts import smoke_provider_reranking as smoke

    monkeypatch.setenv("OPENROUTER_API_KEY", "not-a-real-secret")

    def rerank(
        _client: OpenRouterClient,
        *,
        model: str,
        query: str,
        documents: list[str],
    ) -> RerankResponse:
        assert model == "test-reranker"
        assert query == "What is the capital of France?"
        assert len(documents) == 4
        return RerankResponse.model_validate(
            {
                "results": [
                    {"index": 1, "relevance_score": 0.99},
                    {"index": 3, "relevance_score": 0.7},
                    {"index": 2, "relevance_score": 0.2},
                    {"index": 0, "relevance_score": 0.1},
                ]
            }
        )

    monkeypatch.setattr(OpenRouterClient, "rerank", rerank)

    result = smoke.run_live_smoke(
        smoke.LiveRerankingTarget(provider="openrouter", model="test-reranker")
    )

    assert result.reranked_count == 4
    assert result.top_chunk_id == "live-smoke:1"
    assert result.limited_count == 2


def test_live_smoke_rejects_an_incorrect_top_ranking(monkeypatch) -> None:
    """Candidate preservation alone cannot pass when the semantic winner is wrong."""
    from app.clients.openrouter import OpenRouterClient
    from app.schemas.chat_completions import RerankResponse
    from scripts import smoke_provider_reranking as smoke

    monkeypatch.setenv("OPENROUTER_API_KEY", "not-a-real-secret")

    def rerank(
        _client: OpenRouterClient,
        *,
        model: str,
        query: str,
        documents: list[str],
    ) -> RerankResponse:
        del model, query, documents
        return RerankResponse.model_validate(
            {
                "results": [
                    {"index": 0, "relevance_score": 0.99},
                    {"index": 1, "relevance_score": 0.7},
                    {"index": 2, "relevance_score": 0.2},
                    {"index": 3, "relevance_score": 0.1},
                ]
            }
        )

    monkeypatch.setattr(OpenRouterClient, "rerank", rerank)

    with pytest.raises(smoke.LiveSmokeError, match=smoke.SAFE_SMOKE_FAILURE_MESSAGE):
        smoke.run_live_smoke(
            smoke.LiveRerankingTarget(provider="openrouter", model="test-reranker")
        )


def test_live_collection_hook_skips_only_live_reranking_items() -> None:
    """Selecting the live directory cannot skip unrelated tests in that invocation."""
    from tests.live import conftest as live_conftest

    class Config:
        @staticmethod
        def getoption(_name: str) -> bool:
            return False

    class Item:
        def __init__(self, *, marked_live: bool) -> None:
            self.marked_live = marked_live
            self.added_markers: list[object] = []

        def get_closest_marker(self, name: str) -> object | None:
            if name == "live_provider_reranking" and self.marked_live:
                return object()
            return None

        def add_marker(self, marker: object) -> None:
            self.added_markers.append(marker)

    live_item = Item(marked_live=True)
    unrelated_item = Item(marked_live=False)

    live_conftest.pytest_collection_modifyitems(Config(), [live_item, unrelated_item])

    assert len(live_item.added_markers) == 1
    assert unrelated_item.added_markers == []
