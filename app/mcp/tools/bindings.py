"""A collection's bound pipelines, exposed as MCP tools.

The tool identity, description, and parameter schema come from the same
`to_tool_read` projection chat advertises to providers, so an agent connecting
over MCP sees exactly the tool the platform's own chat sees — there is no second
place a tool's shape is decided. Execution goes through `ToolInvocationService`,
the single pipeline-invocation path, so an MCP call is recorded (query event,
telemetry, trace) identically to a call from the UI.
"""

from __future__ import annotations

from typing import Any

from app.mcp.tools.base import McpTool, McpToolContext, error_result, text_result
from app.schemas.enums import ApiKeyCapability
from app.schemas.mcp import CallToolResult, ToolAnnotations
from app.schemas.tools import CollectionToolRead, ToolInvocationResponse
from app.services.errors import ServiceError
from app.services.pipeline_resolution import ResolvedPipeline
from app.services.tool_invocation import RetrievalPipelineError, ToolInvocationService
from app.services.tool_projection import to_tool_read

#: Chunk text is truncated in the text rendering at this many characters so one
#: call cannot flood an agent's context; `structuredContent` carries it whole.
_TEXT_PREVIEW_CHARS = 2000


class BindingTool(McpTool):
    """One bound pipeline, callable over MCP."""

    capability = ApiKeyCapability.TOOLS_INVOKE

    def __init__(
        self,
        context: McpToolContext,
        resolved: ResolvedPipeline,
        *,
        exposed_name: str | None = None,
    ) -> None:
        """Bind the tool to its resolved pipeline and request context."""
        super().__init__(context)
        self.resolved = resolved
        self.projection: CollectionToolRead = to_tool_read(
            resolved, context.collection, exposed_name=exposed_name
        )

    @property
    def name(self) -> str:
        """The collection-namespaced tool name (same as chat exposes)."""
        return self.projection.name

    @property
    def title(self) -> str | None:
        """The pipeline's name, for client UIs."""
        return self.projection.pipeline_name

    @property
    def description(self) -> str:
        """The projected description, including the collection it reaches."""
        return self.projection.description

    @property
    def input_schema(self) -> dict[str, Any]:
        """The pipeline's declared parameter schema."""
        return self.projection.parameters

    @property
    def output_schema(self) -> dict[str, Any] | None:
        """Return the result schema for this tool's output kind."""
        if self.projection.output_kind == "structured":
            return _structured_output_schema(self.projection.output_fields)
        return _chunks_output_schema()

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Retrieval reads only, and reaches an external index."""
        return ToolAnnotations(read_only_hint=True, destructive_hint=False, open_world_hint=True)

    def invoke(self, raw_arguments: dict[str, Any]) -> CallToolResult:
        """Run the bound pipeline with the caller's arguments.

        The pipeline owns argument validation (declared types, enums, bounds),
        so an invalid value surfaces as a tool execution error the model can
        correct rather than a protocol fault.
        """
        arguments = dict(raw_arguments)
        query = arguments.pop("query", None)
        if not isinstance(query, str) or not query.strip():
            return error_result("Invalid arguments: query: a non-empty string is required")
        top_k = arguments.pop("top_k", None)
        if top_k is not None and not isinstance(top_k, int):
            return error_result("Invalid arguments: top_k: an integer is required")
        try:
            response = ToolInvocationService(self.context.session).invoke(
                self.context.user,
                self.context.collection,
                self.resolved,
                query,
                top_k=top_k,
                arguments=arguments,
            )
        except RetrievalPipelineError as exc:
            return error_result(_failure_message(exc))
        except ServiceError as exc:
            return error_result(f"Tool call failed: {exc.detail}")
        return _render(response)


def _failure_message(exc: RetrievalPipelineError) -> str:
    """Render a failed pipeline run as one actionable line for the agent."""
    detail = exc.detail
    if isinstance(detail, dict):
        message = detail.get("message")
        if isinstance(message, str):
            return message
    return "Tool call failed while running the search tool."


def _render(response: ToolInvocationResponse) -> CallToolResult:
    """Shape an invocation response as an MCP tool result."""
    if response.kind == "structured":
        summary = "\n".join(f"{key}: {value}" for key, value in response.outputs.items())
        return text_result(summary or "The tool returned no outputs.", response.outputs)
    lines = [f"{len(response.chunks)} result(s) for: {response.query}"]
    for position, chunk in enumerate(response.chunks, start=1):
        text = (
            chunk.text
            if len(chunk.text) <= _TEXT_PREVIEW_CHARS
            else (f"{chunk.text[:_TEXT_PREVIEW_CHARS]}…")
        )
        lines.append(f"\n[{position}] score={chunk.score:.4f} chunk={chunk.chunk_id}\n{text}")
    structured = {
        "query": response.query,
        "top_k": response.top_k,
        "chunks": [
            {
                "chunk_id": chunk.chunk_id,
                "document_id": str(chunk.document_id),
                "score": chunk.score,
                "text": chunk.text,
                "metadata": chunk.metadata,
            }
            for chunk in response.chunks
        ],
    }
    if response.outputs:
        structured["outputs"] = response.outputs
    return text_result("\n".join(lines), structured)


def _chunks_output_schema() -> dict[str, Any]:
    """Return the declared result schema for a chunk-returning tool."""
    return {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "top_k": {"type": "integer"},
            "chunks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "chunk_id": {"type": "string"},
                        "document_id": {"type": "string"},
                        "score": {"type": "number"},
                        "text": {"type": "string"},
                        "metadata": {"type": "object"},
                    },
                    "required": ["chunk_id", "document_id", "score", "text"],
                },
            },
        },
        "required": ["query", "chunks"],
    }


def _structured_output_schema(fields: list[str]) -> dict[str, Any] | None:
    """Return the result schema for a structured tool, if it declares fields.

    Field *types* are not part of a pipeline's declared outputs, so each field
    is advertised untyped and nothing is marked required — a schema that
    claimed types or guaranteed presence would be a promise the pipeline never
    made. A pipeline declaring no fields advertises no output schema at all.
    """
    if not fields:
        return None
    return {
        "type": "object",
        "properties": {name: {} for name in fields},
        "additionalProperties": True,
    }


def binding_tools(context: McpToolContext, resolved: list[ResolvedPipeline]) -> list[BindingTool]:
    """Build one tool per resolved binding, keeping exposed names unique.

    Two bound pipelines can project the same name (same base tool identity in
    one collection); a `_2`/`_3` suffix keeps both callable, matching what chat
    does. Dropping the collision instead would silently hide a bound tool.
    """
    tools: list[BindingTool] = []
    taken: set[str] = set()
    for item in resolved:
        tool = BindingTool(context, item)
        if tool.name in taken:
            suffix = 2
            while f"{tool.name}_{suffix}" in taken:
                suffix += 1
            tool = BindingTool(context, item, exposed_name=f"{tool.name}_{suffix}")
        taken.add(tool.name)
        tools.append(tool)
    return tools
