"""Cohere connected, wizard unfinished — an API-key provider mid-setup state."""

from __future__ import annotations

from sandbox.builders import add_provider_connection, create_admin_user
from sandbox.context import SeedContext
from sandbox.registry import scenario


@scenario(
    name="cohere-connected",
    description="Admin user with a working Cohere connection (API key from `.env.sandbox`), but no index or collection — the setup wizard resumes at index/collection creation.",
    requires=("cohere",),
    state=(
        "one admin user (the standard sandbox login)",
        "a live-validated Cohere connection (embeddings + reranking)",
        "pgvector is available as the vector store; no index or collection yet",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Register the user and attach a real Cohere connection from the environment."""
    create_admin_user(ctx)
    add_provider_connection(ctx, "cohere")
