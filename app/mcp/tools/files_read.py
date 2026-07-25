"""Read-only file tools (`files:read`): list, read, and search a collection's files.

These give an agent the same navigation the Files page has — `ls` by path,
file contents, and name/content search — through the existing services, so
ownership scoping and ingestion status are whatever the platform already says
they are. Text is returned decoded; a binary file is refused with a readable
error rather than mangled bytes, because a tool result is model context.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field

from app.mcp.tools.base import (
    McpTool,
    McpToolContext,
    ToolArguments,
    TypedTool,
    error_result,
    text_result,
)
from app.mcp.tools.paths import describe_entry, is_root, resolve_node
from app.schemas.enums import ApiKeyCapability, FileNodeKind
from app.schemas.mcp import CallToolResult, ToolAnnotations
from app.services.errors import ServiceError
from app.services.file_search import SEARCH_MODES, FileSearchService
from app.services.files import FileSystemService

#: Hard cap on returned file text, so one call cannot exhaust an agent's context.
MAX_READ_CHARS = 100_000
#: Read-only annotation shared by every tool in this module.
_READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True)


class ListFilesArguments(ToolArguments):
    """Arguments for `list_files`."""

    path: str = Field(
        default="/",
        description="Folder path to list; '/' is the collection root.",
    )


class ListFilesTool(TypedTool[ListFilesArguments]):
    """List one folder's immediate children."""

    capability = ApiKeyCapability.FILES_READ
    arguments_model = ListFilesArguments

    @property
    def name(self) -> str:
        """The advertised tool name."""
        return "list_files"

    @property
    def title(self) -> str | None:
        """Human-readable title."""
        return "List files"

    @property
    def description(self) -> str:
        """What the tool does, and which collection it reads."""
        return (
            "List the files and folders in one folder of the document collection "
            f"'{self.context.collection.name}'. Paths are slash-separated; '/' is the root."
        )

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Listing never mutates."""
        return _READ_ONLY

    def run(self, arguments: ListFilesArguments) -> CallToolResult:
        """Return the folder's entries, or an error for a bad path."""
        service = FileSystemService(self.context.session)
        collection = self.context.collection
        try:
            parent_id = (
                None
                if is_root(arguments.path)
                else resolve_node(service, collection, arguments.path).id
            )
            listing = service.listing(collection, parent_id)
        except ServiceError as exc:
            return error_result(str(exc.detail))
        if not listing.entries:
            return text_result(
                f"'{arguments.path}' is empty.",
                {"path": arguments.path, "entries": []},
            )
        lines = [describe_entry(entry) for entry in listing.entries]
        structured = {
            "path": arguments.path,
            "entries": [
                {
                    "path": entry.path,
                    "name": entry.name,
                    "kind": entry.kind.value,
                    "content_type": entry.content_type,
                    "size_bytes": entry.size_bytes,
                    "ingestion_status": (
                        entry.ingestion.status.value if entry.ingestion else None
                    ),
                }
                for entry in listing.entries
            ],
        }
        return text_result("\n".join(lines), structured)


class ReadFileArguments(ToolArguments):
    """Arguments for `read_file`."""

    path: str = Field(description="Path of the file to read.")


class ReadFileTool(TypedTool[ReadFileArguments]):
    """Return one file's text content."""

    capability = ApiKeyCapability.FILES_READ
    arguments_model = ReadFileArguments

    @property
    def name(self) -> str:
        """The advertised tool name."""
        return "read_file"

    @property
    def title(self) -> str | None:
        """Human-readable title."""
        return "Read file"

    @property
    def description(self) -> str:
        """What the tool does, including its truncation contract."""
        return (
            "Read a text file from the document collection "
            f"'{self.context.collection.name}'. Returns UTF-8 text, truncated at "
            f"{MAX_READ_CHARS} characters; binary files are refused."
        )

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Reading never mutates."""
        return _READ_ONLY

    def run(self, arguments: ReadFileArguments) -> CallToolResult:
        """Return the file's decoded text, or a readable refusal."""
        service = FileSystemService(self.context.session)
        try:
            node = resolve_node(service, self.context.collection, arguments.path)
        except ServiceError as exc:
            return error_result(str(exc.detail))
        if node.kind != FileNodeKind.FILE or not node.storage_path:
            return error_result(f"'{arguments.path}' is not a readable file.")
        source = Path(node.storage_path)
        if not source.exists():
            return error_result(f"'{arguments.path}' has no stored content.")
        try:
            content = source.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            return error_result(
                f"'{arguments.path}' is not UTF-8 text ({node.content_type or 'unknown type'}); "
                "read it through the web UI instead."
            )
        truncated = len(content) > MAX_READ_CHARS
        body = content[:MAX_READ_CHARS] if truncated else content
        return text_result(
            body,
            {
                "path": arguments.path,
                "content": body,
                "content_type": node.content_type,
                "truncated": truncated,
            },
        )


class SearchFilesArguments(ToolArguments):
    """Arguments for `search_files`."""

    query: str = Field(description="Text to match against file and folder names.")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum matches to return.")


class SearchFilesTool(TypedTool[SearchFilesArguments]):
    """Find files and folders by name."""

    capability = ApiKeyCapability.FILES_READ
    arguments_model = SearchFilesArguments

    @property
    def name(self) -> str:
        """The advertised tool name."""
        return "search_files"

    @property
    def title(self) -> str | None:
        """Human-readable title."""
        return "Search files by name"

    @property
    def description(self) -> str:
        """What the tool does, and how it differs from retrieval.

        Names only: content search belongs to the collection's retrieval tools,
        which run the user's own pipeline instead of a substring match.
        """
        return (
            "Find files and folders by name in the document collection "
            f"'{self.context.collection.name}'. Searches names only — to search "
            "document contents, use this collection's retrieval tool."
        )

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Searching never mutates."""
        return _READ_ONLY

    def run(self, arguments: SearchFilesArguments) -> CallToolResult:
        """Return name matches for the query."""
        results = FileSearchService(self.context.session).search(
            self.context.user,
            self.context.collection,
            query=arguments.query,
            modes=SEARCH_MODES - {"content"},
            top_k=arguments.limit,
        )
        matches = [*results.folders, *results.files][: arguments.limit]
        if not matches:
            return text_result(
                f"No files or folders match '{arguments.query}'.",
                {"query": arguments.query, "matches": []},
            )
        return text_result(
            "\n".join(describe_entry(entry) for entry in matches),
            {
                "query": arguments.query,
                "matches": [
                    {"path": entry.path, "kind": entry.kind.value} for entry in matches
                ],
            },
        )


def read_tools(context: McpToolContext) -> list[McpTool]:
    """Build the read-only file tools for a request."""
    return [ListFilesTool(context), ReadFileTool(context), SearchFilesTool(context)]
