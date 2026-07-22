"""Key preflight: missing and rejected credentials fail loudly before any seeding."""

from __future__ import annotations

import pytest

from app.providers.base import ConnectionValidationResult
from sandbox import keys
from sandbox.keys import PreflightError, preflight, provider_config, required_env_vars


def test_missing_key_names_the_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unset required key aborts with the variable name and env-file hint."""
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(PreflightError, match="OPENROUTER_API_KEY"):
        preflight(("openrouter",))


def test_missing_base_url_names_the_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    """A base-URL provider names its own required var, not an api key."""
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    with pytest.raises(PreflightError, match="OLLAMA_BASE_URL"):
        preflight(("ollama",))


def test_rejected_credentials_surface_the_provider_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A credential the provider rejects aborts with the provider's own message."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-bad")
    monkeypatch.setattr(
        keys,
        "_validate_config",
        lambda provider, config: "Invalid credentials",
    )
    with pytest.raises(PreflightError, match="Invalid credentials"):
        preflight(("openrouter",))


def test_valid_credentials_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    """A config the provider accepts lets seeding proceed."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-good")
    monkeypatch.setattr(keys, "_validate_config", lambda provider, config: None)
    preflight(("openrouter",))


def test_unknown_provider_requirement_is_rejected() -> None:
    """Requiring a provider the preflight can't check is a scenario bug."""
    with pytest.raises(PreflightError, match="Unknown provider"):
        preflight(("not-a-provider",))


def test_required_env_vars_lists_only_required_fields() -> None:
    """Display helper omits optional fields (Ollama's api key is optional)."""
    assert required_env_vars("openrouter") == ("OPENROUTER_API_KEY",)
    assert required_env_vars("ollama") == ("OLLAMA_BASE_URL",)
    assert required_env_vars("unknown") == ()


def test_provider_config_assembles_the_shape_the_app_expects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An api-key provider yields {api_key}; a base-URL provider yields
    {base_url} and includes the optional api key only when it is set."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-x")
    assert provider_config("openrouter") == {"api_key": "sk-or-x"}

    monkeypatch.setenv("OLLAMA_BASE_URL", "http://host:11434")
    monkeypatch.delenv("OLLAMA_API_KEY", raising=False)
    assert provider_config("ollama") == {"base_url": "http://host:11434"}

    monkeypatch.setenv("OLLAMA_API_KEY", "secret")
    assert provider_config("ollama") == {
        "base_url": "http://host:11434",
        "api_key": "secret",
    }


def test_provider_config_returns_none_when_a_required_field_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A missing required var yields None so builders fail rather than seed junk."""
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    assert provider_config("ollama") is None
    assert provider_config("unknown") is None


def test_validate_config_uses_the_apps_own_validation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Preflight goes through build_adapter().validate_connection() — the same
    check the connections API runs at save time — with the assembled config."""
    captured: dict[str, object] = {}

    class FakeAdapter:
        def validate_connection(self) -> ConnectionValidationResult:
            return ConnectionValidationResult(valid=False, message="nope")

    def fake_build_adapter(connection: object) -> FakeAdapter:
        captured["connection"] = connection
        return FakeAdapter()

    import app.providers.registry as registry_module

    monkeypatch.setattr(registry_module, "build_adapter", fake_build_adapter)
    assert keys._validate_config("ollama", {"base_url": "http://host:11434"}) == "nope"
    connection = captured["connection"]
    assert connection.provider_type == "ollama"
    assert connection.config == {"base_url": "http://host:11434"}
