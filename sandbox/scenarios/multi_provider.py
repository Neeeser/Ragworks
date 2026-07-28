"""OpenAI and Anthropic connected side by side — the cross-dialect state.

The point of this scenario is that three wire formats are live at once:
OpenRouter and OpenAI Chat Completions, OpenAI Responses, and Anthropic
Messages. Anything that must behave identically across dialects — model
pickers, parameter panels, chat streaming, reasoning display — is exercised by
switching connections inside one seeded account rather than reseeding per
provider.
"""

from __future__ import annotations

from sandbox.builders import add_provider_connection, create_admin_user
from sandbox.context import SeedContext
from sandbox.registry import scenario


@scenario(
    name="multi-provider",
    description="Admin user with live OpenRouter, OpenAI, and Anthropic connections — three chat dialects available at once for cross-provider comparison.",
    requires=("openrouter", "openai", "anthropic"),
    state=(
        "one admin user (the standard sandbox login)",
        "a live-validated OpenRouter connection (embeddings + chat + reranking)",
        "a live-validated OpenAI connection (embeddings + chat, Responses dialect)",
        "a live-validated Anthropic connection (chat only)",
        "pgvector is available as the vector store; no index or collection yet",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Register the user and attach one connection per chat dialect."""
    create_admin_user(ctx)
    add_provider_connection(ctx, "openrouter")
    add_provider_connection(ctx, "openai")
    add_provider_connection(ctx, "anthropic")
