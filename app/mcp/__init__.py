"""MCP exposure: a collection's tools as a Streamable HTTP MCP server.

The package's public API is `McpServer` (JSON-RPC dispatch) plus `McpToolContext`
(the per-request identity a server answers for); the transport rules live in
`transport.py` and are used by the route, and tool implementations live under
`tools/`. Consumers import those from their owning module.
"""

from __future__ import annotations

from app.mcp.server import McpServer
from app.mcp.tools.base import McpToolContext

__all__ = ["McpServer", "McpToolContext"]
