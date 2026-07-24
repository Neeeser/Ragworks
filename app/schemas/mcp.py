"""MCP wire types: JSON-RPC envelopes and the tool-server result shapes.

The Model Context Protocol is JSON-RPC 2.0 with camelCase members, so every
model here declares snake_case fields with a camelCase alias generator and is
serialized `by_alias=True` at the single response-shaping point in
`app/mcp/transport.py`. Only the subset a tools-only server needs is modeled:
`initialize`, `tools/list`, `tools/call`, `ping`. Anything else is answered
with a method-not-found error rather than a half-implemented capability.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

#: Protocol revisions this server speaks, newest first. `initialize` echoes the
#: client's version when it appears here, else the newest (the spec's
#: negotiation rule: offer the latest supported and let the client decide).
SUPPORTED_PROTOCOL_VERSIONS: tuple[str, ...] = ("2025-11-25", "2025-06-18", "2025-03-26")
LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]
#: Assumed when a request carries no `MCP-Protocol-Version` header, per spec.
FALLBACK_PROTOCOL_VERSION = "2025-03-26"


class McpModel(BaseModel):
    """Base for MCP wire models: snake_case fields, camelCase on the wire."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class JsonRpcRequest(McpModel):
    """One incoming JSON-RPC message.

    A message without `id` is a notification (no response is returned); MCP
    forbids a null id on a request, so `id is None` means notification here.
    """

    jsonrpc: Literal["2.0"]
    method: str = Field(min_length=1)
    id: str | int | None = None
    params: dict[str, Any] | None = None

    @property
    def is_notification(self) -> bool:
        """Return whether this message expects no response."""
        return self.id is None


class JsonRpcErrorBody(McpModel):
    """The `error` member of a JSON-RPC error response."""

    code: int
    message: str
    data: dict[str, Any] | None = None


class JsonRpcErrorResponse(McpModel):
    """A JSON-RPC error response."""

    jsonrpc: Literal["2.0"] = "2.0"
    id: str | int | None = None
    error: JsonRpcErrorBody


class JsonRpcSuccessResponse(McpModel):
    """A JSON-RPC success response."""

    jsonrpc: Literal["2.0"] = "2.0"
    id: str | int
    result: dict[str, Any]


class Implementation(McpModel):
    """Server identity reported in `initialize`."""

    name: str
    version: str
    title: str | None = None


class ToolsCapability(McpModel):
    """The tools capability block.

    `list_changed` is false: a stateless server sends no notifications, and
    claiming otherwise would promise a stream we never open.
    """

    list_changed: bool = False


class ServerCapabilities(McpModel):
    """What this server offers — tools only, deliberately."""

    tools: ToolsCapability = Field(default_factory=ToolsCapability)


class InitializeResult(McpModel):
    """The `initialize` result."""

    protocol_version: str
    capabilities: ServerCapabilities
    server_info: Implementation
    instructions: str | None = None


class ToolAnnotations(McpModel):
    """Behavior hints a client uses to decide how freely to call a tool."""

    title: str | None = None
    read_only_hint: bool | None = None
    destructive_hint: bool | None = None
    idempotent_hint: bool | None = None
    open_world_hint: bool | None = None


class ToolDefinition(McpModel):
    """One tool as `tools/list` advertises it."""

    name: str
    description: str
    input_schema: dict[str, Any]
    title: str | None = None
    output_schema: dict[str, Any] | None = None
    annotations: ToolAnnotations | None = None


class ListToolsResult(McpModel):
    """The `tools/list` result. No cursor: every tool is returned at once."""

    tools: list[ToolDefinition] = Field(default_factory=list)


class TextContent(McpModel):
    """A text content block."""

    type: Literal["text"] = "text"
    text: str


class CallToolResult(McpModel):
    """The `tools/call` result.

    Tool *execution* failures are reported here with `is_error=True` — not as
    JSON-RPC errors — so the calling model sees the failure and can correct
    itself. Only protocol faults (unknown method, unknown tool) are JSON-RPC
    errors.
    """

    content: list[TextContent] = Field(default_factory=list)
    structured_content: dict[str, Any] | None = None
    is_error: bool = False
