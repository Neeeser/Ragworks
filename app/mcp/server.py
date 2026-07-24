"""JSON-RPC method dispatch for one collection-scoped MCP server.

The server is stateless: every request carries its own credential and is
answered on its own, so no session is issued and nothing is remembered between
calls. That is what lets the endpoint sit behind the same request/response
lifecycle as the rest of the API instead of a long-lived connection.

Only the methods a tools-only server owes exist here — `initialize`, `ping`,
`tools/list`, `tools/call`, and the notifications a client sends during
handshake. Anything else is a method-not-found error, which is the honest answer
for a capability we never advertised in `initialize`.
"""

from __future__ import annotations

from typing import Any

from app.mcp.errors import INVALID_PARAMS, METHOD_NOT_FOUND, ProtocolError
from app.mcp.tools.base import McpTool, McpToolContext
from app.mcp.tools.registry import build_tools
from app.mcp.transport import negotiate_initialize_version
from app.schemas.mcp import (
    CallToolResult,
    Implementation,
    InitializeResult,
    JsonRpcRequest,
    ListToolsResult,
    McpModel,
    ServerCapabilities,
)

#: Reported as the server implementation version.
SERVER_VERSION = "1"


class McpServer:
    """Answer MCP messages for one authenticated request context."""

    def __init__(self, context: McpToolContext) -> None:
        """Bind the server to the request's collection and principal."""
        self.context = context
        self._tool_set: list[McpTool] | None = None

    def handle(self, message: JsonRpcRequest) -> McpModel | None:
        """Dispatch one message, returning None for notifications.

        Every notification is accepted without work: a stateless server keeps
        no handshake state to advance, and JSON-RPC forbids responding to a
        notification, so an error here could only be invisible.
        """
        if message.is_notification:
            return None
        if message.method == "initialize":
            return self._initialize(message.params or {})
        if message.method == "ping":
            return _EmptyResult()
        if message.method == "tools/list":
            return self._list_tools()
        if message.method == "tools/call":
            return self._call_tool(message.params or {})
        raise ProtocolError(METHOD_NOT_FOUND, f"Method not found: {message.method}")

    def _initialize(self, params: dict[str, Any]) -> InitializeResult:
        """Answer the handshake, naming the collection this server serves."""
        requested = params.get("protocolVersion")
        collection = self.context.collection
        description = (collection.description or "").strip()
        instructions = (
            f"This server exposes the Ragworks document collection '{collection.name}'. "
            + (f"{description} " if description else "")
            + "Call its retrieval tools to search the collection's indexed documents; "
            "results are chunks with relevance scores."
        )
        return InitializeResult(
            protocol_version=negotiate_initialize_version(
                requested if isinstance(requested, str) else None
            ),
            capabilities=ServerCapabilities(),
            server_info=Implementation(
                name=f"ragworks-{collection.name}",
                title=f"Ragworks: {collection.name}",
                version=SERVER_VERSION,
            ),
            instructions=instructions,
        )

    def _list_tools(self) -> ListToolsResult:
        """List every tool the calling key may use."""
        return ListToolsResult(tools=[tool.definition() for tool in self._tools()])

    def _call_tool(self, params: dict[str, Any]) -> CallToolResult:
        """Run one named tool.

        An unknown name is a protocol error (invalid params), per spec — the
        tool genuinely does not exist for this caller. Failures *inside* a tool
        are reported in the result with `isError`, so the model can react.
        """
        name = params.get("name")
        if not isinstance(name, str) or not name:
            raise ProtocolError(INVALID_PARAMS, "A tool name is required.")
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            raise ProtocolError(INVALID_PARAMS, "Tool arguments must be an object.")
        tool = next((item for item in self._tools() if item.name == name), None)
        if tool is None:
            raise ProtocolError(INVALID_PARAMS, f"Unknown tool: {name}")
        return tool.invoke(arguments)

    def _tools(self) -> list[McpTool]:
        """Return this request's capability-filtered tool set, built once.

        Cached per message because building it resolves the collection's bound
        pipelines; `tools/call` looks a tool up in the same set it would have
        listed, so a call can never reach a tool the listing would have hidden.
        """
        if self._tool_set is None:
            self._tool_set = build_tools(self.context)
        return self._tool_set


class _EmptyResult(McpModel):
    """The empty result object `ping` returns."""
