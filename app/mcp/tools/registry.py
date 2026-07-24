"""Assemble one request's tool set, filtered by the calling key's capabilities.

There is exactly one gate: a tool whose declared capability the key does not
hold is never built, so it cannot appear in `tools/list` and `tools/call` cannot
find it by name. Filtering in one place (rather than checking per tool at call
time) is what makes an unprovisioned capability invisible instead of merely
rejected — an agent never sees a tool it would only be refused.
"""

from __future__ import annotations

from app.mcp.tools.base import McpTool, McpToolContext
from app.mcp.tools.bindings import binding_tools
from app.mcp.tools.files_read import read_tools
from app.mcp.tools.files_write import write_tools
from app.schemas.enums import ApiKeyCapability
from app.services.pipeline_resolution import resolve_tool_bindings


def build_tools(context: McpToolContext) -> list[McpTool]:
    """Build every tool the calling key may use on this collection."""
    granted = context.principal.capabilities()
    tools: list[McpTool] = []
    if ApiKeyCapability.TOOLS_INVOKE in granted:
        resolved = resolve_tool_bindings(
            context.session,
            context.user,
            context.collection,
            enabled_only=True,
            scaffold=False,
        )
        tools.extend(binding_tools(context, list(resolved)))
    if ApiKeyCapability.FILES_READ in granted:
        tools.extend(read_tools(context))
    if ApiKeyCapability.FILES_WRITE in granted:
        tools.extend(write_tools(context))
    return tools
