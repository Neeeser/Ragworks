"""Provider credential loading and preflight validation.

Real provider credentials live in the gitignored ``.env.sandbox`` (see
``.env.sandbox.example``); this module loads them into the process environment
and, for the providers a scenario declares, assembles each one's connection
config and validates it before any state is touched — so a missing or broken
credential fails with its env-var name instead of seeding a half-working state.

Each provider's config shape is declared once in ``PROVIDER_SPECS`` — which env
vars map to which ``provider_connections.config`` keys, and which are required
— so supporting a new provider (an API-key provider like Cohere, or a base-URL
one like Ollama/TEI) is a single table entry, mirroring the per-type config
models in ``app/schemas/providers.py``. Validation reuses the app's own
``validate_connection`` on a transient (never persisted) connection row — the
exact check the connections API runs at save time, so preflight can't drift
from what the app accepts.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from sandbox.config import ENV_FILE


@dataclass(frozen=True)
class EnvField:
    """One connection-config field sourced from an environment variable."""

    config_key: str
    env_var: str
    required: bool = True


@dataclass(frozen=True)
class ProviderSpec:
    """How a provider type's sandbox connection config is built from the environment."""

    display_name: str
    fields: tuple[EnvField, ...]


PROVIDER_SPECS: dict[str, ProviderSpec] = {
    "openrouter": ProviderSpec(
        "OpenRouter", (EnvField("api_key", "OPENROUTER_API_KEY"),)
    ),
    "cohere": ProviderSpec("Cohere", (EnvField("api_key", "COHERE_API_KEY"),)),
    "pinecone": ProviderSpec("Pinecone", (EnvField("api_key", "PINECONE_API_KEY"),)),
    "ollama": ProviderSpec(
        "Ollama",
        (
            EnvField("base_url", "OLLAMA_BASE_URL"),
            EnvField("api_key", "OLLAMA_API_KEY", required=False),
        ),
    ),
    "tei": ProviderSpec(
        "TEI",
        (
            EnvField("base_url", "TEI_BASE_URL"),
            EnvField("api_key", "TEI_API_KEY", required=False),
        ),
    ),
}


class PreflightError(SystemExit):
    """A required provider credential is missing or rejected; abort before seeding."""


def load_env_file() -> None:
    """Load ``.env.sandbox`` into the environment without overriding real vars."""
    if not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip("'\""))


def required_env_vars(provider: str) -> tuple[str, ...]:
    """The env vars a provider requires, for CLI and catalog display."""
    spec = PROVIDER_SPECS.get(provider)
    if spec is None:
        return ()
    return tuple(field.env_var for field in spec.fields if field.required)


def provider_config(provider: str) -> dict[str, str] | None:
    """Assemble a provider's connection config from the environment.

    Returns ``None`` when a required field's env var is unset; optional fields
    are included only when present. This is the config a builder hands to
    ``ConnectionService.create`` — the same shape ``ConnectionCreate`` expects.
    """
    spec = PROVIDER_SPECS.get(provider)
    if spec is None:
        return None
    config: dict[str, str] = {}
    for field in spec.fields:
        value = os.getenv(field.env_var)
        if value:
            config[field.config_key] = value
        elif field.required:
            return None
    return config


def preflight(requires: tuple[str, ...]) -> None:
    """Validate every required provider's config live; raise `PreflightError` on failure."""
    for provider in requires:
        spec = PROVIDER_SPECS.get(provider)
        if spec is None:
            raise PreflightError(f"Unknown provider requirement '{provider}'.")
        config: dict[str, str] = {}
        for field in spec.fields:
            value = os.getenv(field.env_var)
            if value:
                config[field.config_key] = value
            elif field.required:
                raise PreflightError(
                    f"{field.env_var} is not set — required by this scenario. "
                    f"Add it to {ENV_FILE.name} (see .env.sandbox.example)."
                )
        message = _validate_config(provider, config)
        if message is not None:
            raise PreflightError(
                f"{spec.display_name} rejected the configured credentials: {message}"
            )


def _validate_config(provider: str, config: dict[str, str]) -> str | None:
    """Run the app's live connection validation; return an error message or None."""
    from uuid import uuid4

    from app.db import models
    from app.providers.registry import build_adapter

    connection = models.ProviderConnection(
        user_id=uuid4(),
        provider_type=provider,
        label="sandbox-preflight",
        config=config,
    )
    result = build_adapter(connection).validate_connection()
    if result.valid:
        return None
    return result.message or "connection validation failed"
