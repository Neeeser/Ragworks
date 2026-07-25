"""The MCP tool contract: one class per tool, one capability per tool.

Every tool declares the `ApiKeyCapability` it needs, so the registry can filter
a request's tool set by the calling key's grants — an unprovisioned capability's
tools are absent from `tools/list` and unknown to `tools/call`, rather than
present-but-rejected.

Two levels exist because tool shapes genuinely differ. `TypedTool` covers tools
whose arguments are fixed: a Pydantic model's JSON schema *is* the advertised
`inputSchema`, so the schema an agent reads and the validation it hits can never
disagree. Bound pipelines instead publish a schema derived from their own
declared arguments and validate inside the pipeline run, so they implement the
narrower `McpTool` contract directly.

A validation failure returns a tool execution error (`is_error=True`), not a
JSON-RPC error: the spec (2025-11-25) asks for exactly that so the calling model
can see its mistake and retry.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, ValidationError
from sqlmodel import Session

from app.db import models
from app.schemas.enums import ApiKeyCapability
from app.schemas.mcp import CallToolResult, TextContent, ToolAnnotations, ToolDefinition
from app.services.api_keys import KeyPrincipal


class ToolArguments(BaseModel):
    """Base for fixed-shape tool argument models.

    `extra="forbid"` turns a misspelled argument into an explicit error the
    model can correct, instead of a silently ignored key.
    """

    model_config = ConfigDict(extra="forbid")


ArgumentsT = TypeVar("ArgumentsT", bound=ToolArguments)


@dataclass(frozen=True)
class McpToolContext:
    """Everything a tool needs to serve one request."""

    session: Session
    user: models.User
    collection: models.Collection
    principal: KeyPrincipal


def text_result(text: str, structured: dict[str, Any] | None = None) -> CallToolResult:
    """Build a successful result with one text block and optional structure."""
    return CallToolResult(content=[TextContent(text=text)], structured_content=structured)


def error_result(message: str) -> CallToolResult:
    """Build a tool execution error the calling model can read and retry."""
    return CallToolResult(content=[TextContent(text=message)], is_error=True)


class McpTool(ABC):
    """One callable tool bound to a request's context."""

    #: The capability a key must hold for this tool to exist for it.
    capability: ApiKeyCapability

    def __init__(self, context: McpToolContext) -> None:
        """Bind the tool to the request context it will serve."""
        self.context = context

    @property
    @abstractmethod
    def name(self) -> str:
        """The tool's advertised name."""

    @property
    @abstractmethod
    def description(self) -> str:
        """The tool's advertised description."""

    @property
    @abstractmethod
    def input_schema(self) -> dict[str, Any]:
        """The tool's advertised JSON Schema for arguments."""

    @property
    def title(self) -> str | None:
        """Optional human-readable title for client UIs."""
        return None

    @property
    def output_schema(self) -> dict[str, Any] | None:
        """Optional schema for `structuredContent`; None when unstructured."""
        return None

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Optional behavior hints (read-only, destructive, idempotent)."""
        return None

    def definition(self) -> ToolDefinition:
        """Project the tool onto its `tools/list` entry."""
        return ToolDefinition(
            name=self.name,
            title=self.title,
            description=self.description,
            input_schema=self.input_schema,
            output_schema=self.output_schema,
            annotations=self.annotations,
        )

    @abstractmethod
    def invoke(self, raw_arguments: dict[str, Any]) -> CallToolResult:
        """Run the tool against the caller's raw argument mapping."""


class TypedTool(McpTool, Generic[ArgumentsT]):
    """A tool whose arguments are a fixed Pydantic model."""

    #: Argument model; its JSON schema is the advertised `inputSchema`.
    arguments_model: type[ArgumentsT]

    @property
    def input_schema(self) -> dict[str, Any]:
        """Return the argument model's JSON schema."""
        schema = self.arguments_model.model_json_schema()
        schema.pop("title", None)
        return schema

    def invoke(self, raw_arguments: dict[str, Any]) -> CallToolResult:
        """Validate arguments against the model, then run."""
        try:
            arguments = self.arguments_model.model_validate(raw_arguments)
        except ValidationError as exc:
            return error_result(f"Invalid arguments: {readable_validation_error(exc)}")
        return self.run(arguments)

    @abstractmethod
    def run(self, arguments: ArgumentsT) -> CallToolResult:
        """Execute the tool against its validated argument model."""


def readable_validation_error(exc: ValidationError) -> str:
    """Render a validation error as one line an agent can act on."""
    parts = []
    for error in exc.errors():
        location = ".".join(str(item) for item in error["loc"]) or "arguments"
        parts.append(f"{location}: {error['msg']}")
    return "; ".join(parts)
