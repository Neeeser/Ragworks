"""Contract tests for the opt-in provider reranking smoke harness."""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FORBIDDEN_RUNTIME_PACKAGES = (
    "sentence-transformers",
    "transformers",
    "torch",
    "triton",
    "nvidia-cublas-cu",
    "nvidia-cuda",
)


def test_default_dependency_lock_excludes_local_transformer_runtime() -> None:
    """The shipped application must not bring a local transformer stack with it."""
    dependency_text = (ROOT / "pyproject.toml").read_text(encoding="utf-8").lower()
    lock_text = (ROOT / "uv.lock").read_text(encoding="utf-8").lower()

    for package in FORBIDDEN_RUNTIME_PACKAGES:
        assert package not in dependency_text
        assert f'name = "{package}"' not in lock_text


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
