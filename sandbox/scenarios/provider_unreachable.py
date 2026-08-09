"""A working workspace with one provider that has gone offline."""

from __future__ import annotations

from sandbox.builders import add_downed_provider_connection
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios import collection_ready


@scenario(
    name="provider-unreachable",
    description="collection-ready plus a second provider connection whose server has gone offline — the state every provider-failure surface renders from.",
    requires=("openrouter",),
    state=(
        "everything from collection-ready (connection, indexes, pipelines, 3 documents)",
        'a second connection "Ollama (homelab)" that validated when it was created and '
        "no longer answers — listing its models fails while OpenRouter's still load",
        "model pickers, Settings, and the overview all read that failure from the same "
        "model catalogs, so no surface can disagree with another",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Build the working workspace, then attach a connection that is now down."""
    collection_ready.seed(ctx)
    add_downed_provider_connection(ctx)
