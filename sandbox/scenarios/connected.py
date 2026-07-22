"""Provider connected, wizard unfinished — mid-setup state."""

from __future__ import annotations

from sandbox.builders import add_openrouter_connection, create_admin_user
from sandbox.context import SeedContext
from sandbox.registry import scenario


@scenario(
    name="connected",
    description="Admin user with a working OpenRouter connection, but no index or collection — the setup wizard resumes at index/collection creation.",
    requires=("openrouter",),
    state=(
        "one admin user (the standard sandbox login)",
        "a live-validated OpenRouter connection (embeddings + chat)",
        "pgvector is available as the vector store; no index or collection yet",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Register the user and attach a real OpenRouter connection."""
    create_admin_user(ctx)
    add_openrouter_connection(ctx)
