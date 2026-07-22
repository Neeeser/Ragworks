"""Ollama connected, wizard unfinished — a base-URL provider mid-setup state."""

from __future__ import annotations

from sandbox.builders import add_provider_connection, create_admin_user
from sandbox.context import SeedContext
from sandbox.registry import scenario


@scenario(
    name="ollama-connected",
    description="Admin user with a working Ollama connection (base URL from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation.",
    requires=("ollama",),
    state=(
        "one admin user (the standard sandbox login)",
        "a live-validated Ollama connection (embeddings + chat) at OLLAMA_BASE_URL",
        "pgvector is available as the vector store; no index or collection yet",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Register the user and attach a real Ollama connection from the environment."""
    create_admin_user(ctx)
    add_provider_connection(ctx, "ollama")
