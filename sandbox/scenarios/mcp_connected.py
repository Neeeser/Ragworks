"""collection-ready plus an issued MCP key: the endpoint is callable at once."""

from __future__ import annotations

from sandbox.builders import issue_mcp_key
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.collection_ready import seed as seed_collection_ready


@scenario(
    name="mcp-connected",
    description="collection-ready plus a full-capability MCP API key — the collection's MCP endpoint answers tools/list and tools/call immediately.",
    requires=("openrouter",),
    state=(
        "everything from collection-ready",
        'API key "Sandbox agent" scoped to the seeded collection with '
        "tools:invoke, files:read, and files:write",
        "the key (printed in the handoff as an `mcp key` fact) is the only way to "
        "reach the endpoint; it is unrecoverable afterwards",
        "pointing any MCP client at the printed endpoint with "
        "`Authorization: Bearer <key>` is the remaining action under test",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose collection-ready, then issue the MCP key."""
    seed_collection_ready(ctx)
    issue_mcp_key(ctx)
