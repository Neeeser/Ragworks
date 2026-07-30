"""collection-ready plus direct OpenAI and Anthropic connections.

`multi-provider` seeds the three chat providers but no collection, so the
first-run wizard still covers the console; this composes the wizard-complete
state with the extra connections, which is what cross-provider chat flows
(model picker, parameter panel, streaming) need to run unobstructed.
"""

from __future__ import annotations

from sandbox.builders import add_provider_connection
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.collection_ready import seed as seed_collection_ready


@scenario(
    name="multi-provider-ready",
    description="collection-ready plus live OpenAI and Anthropic connections — cross-provider chat flows run against a wizard-complete console.",
    requires=("openrouter", "openai", "anthropic"),
    state=(
        "everything from collection-ready",
        "a live-validated OpenAI connection (embeddings + chat, Responses API)",
        "a live-validated Anthropic connection (chat only)",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose collection-ready, then attach the direct provider connections."""
    seed_collection_ready(ctx)
    add_provider_connection(ctx, "openai")
    add_provider_connection(ctx, "anthropic")
