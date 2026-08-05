"""Mutating file tools (`files:write`): upload, delete, and create folders.

Uploads go through `FileSystemService.register_upload` and are queued for
ingestion exactly like a browser upload, so a file an agent adds is indexed by
the collection's own ingest pipeline with no second code path. Binary content
travels base64-encoded because MCP tool arguments are JSON; the configured
maximum upload size is enforced on the decoded bytes.

Deletion is annotated destructive so a harness can require confirmation, and it
runs `FileDeletionService` — the owner of the vector/file/row purge sequence —
rather than dropping a row here.
"""

from __future__ import annotations

import base64
import binascii
import mimetypes
from io import BytesIO
from typing import Literal

from pydantic import Field

from app.mcp.tools.base import (
    McpTool,
    McpToolContext,
    ToolArguments,
    TypedTool,
    error_result,
    text_result,
)
from app.mcp.tools.paths import resolve_node, resolve_parent
from app.schemas.enums import ApiKeyCapability, FileNodeKind
from app.schemas.mcp import CallToolResult, ToolAnnotations
from app.services.errors import ServiceError
from app.services.file_deletion import FileDeletionService
from app.services.files import FileSystemService, UploadSpec, upload_size_limit_mb
from app.services.ingestion_queue import enqueue_document_ingestion


class UploadFileArguments(ToolArguments):
    """Arguments for `upload_file`."""

    path: str = Field(
        description=(
            "Destination path within the collection, e.g. 'notes/spec.md'. "
            "Missing folders are created."
        )
    )
    content: str = Field(description="File content: UTF-8 text, or base64 when encoding='base64'.")
    encoding: Literal["utf8", "base64"] = Field(
        default="utf8", description="How `content` is encoded."
    )
    content_type: str | None = Field(
        default=None,
        description="MIME type; inferred from the file extension when omitted.",
    )


class UploadFileTool(TypedTool[UploadFileArguments]):
    """Store a file in the collection and queue it for ingestion."""

    capability = ApiKeyCapability.FILES_WRITE
    arguments_model = UploadFileArguments

    @property
    def name(self) -> str:
        """The advertised tool name."""
        return "upload_file"

    @property
    def title(self) -> str | None:
        """Human-readable title."""
        return "Upload file"

    @property
    def description(self) -> str:
        """What the tool does, including the ingestion consequence."""
        return (
            "Add a file to the document collection "
            f"'{self.context.collection.name}'. Eligible types are queued for "
            "ingestion immediately, so the file becomes searchable once indexing finishes."
        )

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Writes, but never destroys: a name collision is de-duplicated."""
        return ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False)

    def run(self, arguments: UploadFileArguments) -> CallToolResult:
        """Decode, size-check, store, and queue the upload."""
        try:
            payload = _decode(arguments)
        except ValueError as exc:
            return error_result(str(exc))
        filename = arguments.path.rsplit("/", 1)[-1]
        content_type = arguments.content_type or _guess_content_type(filename)
        max_mb = upload_size_limit_mb(content_type)
        if len(payload) > max_mb * 1024 * 1024:
            return error_result(f"Upload exceeds the maximum size of {max_mb}MB.")
        service = FileSystemService(self.context.session)
        spec = UploadSpec(
            filename=filename,
            content_type=content_type,
            relative_path=arguments.path,
        )
        try:
            result = service.register_upload(
                self.context.user, self.context.collection, spec, BytesIO(payload)
            )
        except ServiceError as exc:
            return error_result(str(exc.detail))
        if result.document is not None:
            enqueue_document_ingestion(result.document.id)
        node = service.read_node(result.file)
        return text_result(
            f"Stored '{node.path}' ({node.size_bytes} bytes). "
            + (
                "Queued for ingestion."
                if result.document is not None
                else "Its content type is not auto-ingested, so it is stored but not indexed."
            ),
            {
                "path": node.path,
                "file_id": str(node.id),
                "size_bytes": node.size_bytes,
                "content_type": node.content_type,
                "ingestion_queued": result.document is not None,
            },
        )


class DeleteFileArguments(ToolArguments):
    """Arguments for `delete_file`."""

    path: str = Field(description="Path of the file or folder to delete.")


class DeleteFileTool(TypedTool[DeleteFileArguments]):
    """Delete a file, or a folder and everything under it."""

    capability = ApiKeyCapability.FILES_WRITE
    arguments_model = DeleteFileArguments

    @property
    def name(self) -> str:
        """The advertised tool name."""
        return "delete_file"

    @property
    def title(self) -> str | None:
        """Human-readable title."""
        return "Delete file or folder"

    @property
    def description(self) -> str:
        """What the tool does, and that it is irreversible."""
        return (
            "Permanently delete a file, or a folder and its entire subtree, from the "
            f"document collection '{self.context.collection.name}', including its "
            "indexed vectors. This cannot be undone."
        )

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Destructive: harnesses should confirm before calling."""
        return ToolAnnotations(read_only_hint=False, destructive_hint=True, idempotent_hint=True)

    def run(self, arguments: DeleteFileArguments) -> CallToolResult:
        """Resolve the path and run the deletion service."""
        service = FileSystemService(self.context.session)
        try:
            node = resolve_node(service, self.context.collection, arguments.path)
            # A DB-loaded row's enum column is a raw string; normalize before use.
            kind = FileNodeKind(node.kind)
            FileDeletionService(self.context.session).delete(
                self.context.user, self.context.collection, node
            )
        except ServiceError as exc:
            return error_result(str(exc.detail))
        self.context.session.commit()
        label = "folder" if kind == FileNodeKind.FOLDER else "file"
        return text_result(
            f"Deleted {label} '{arguments.path}'.",
            {"path": arguments.path, "deleted": True, "kind": kind.value},
        )


class CreateFolderArguments(ToolArguments):
    """Arguments for `create_folder`."""

    path: str = Field(description="Path of the folder to create; its parent must exist.")


class CreateFolderTool(TypedTool[CreateFolderArguments]):
    """Create one folder under an existing parent."""

    capability = ApiKeyCapability.FILES_WRITE
    arguments_model = CreateFolderArguments

    @property
    def name(self) -> str:
        """The advertised tool name."""
        return "create_folder"

    @property
    def title(self) -> str | None:
        """Human-readable title."""
        return "Create folder"

    @property
    def description(self) -> str:
        """What the tool does, and its one precondition."""
        return (
            "Create a folder in the document collection "
            f"'{self.context.collection.name}'. The parent folder must already exist; "
            "uploading to a nested path creates missing folders on its own."
        )

    @property
    def annotations(self) -> ToolAnnotations | None:
        """Writes, but never destroys."""
        return ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False)

    def run(self, arguments: CreateFolderArguments) -> CallToolResult:
        """Create the folder named by the path's final segment."""
        service = FileSystemService(self.context.session)
        try:
            parent, name = resolve_parent(service, self.context.collection, arguments.path)
            node = service.create_folder(
                self.context.user,
                self.context.collection,
                name=name,
                parent_id=parent.id if parent else None,
            )
        except ServiceError as exc:
            return error_result(str(exc.detail))
        self.context.session.commit()
        created = service.read_node(node)
        return text_result(
            f"Created folder '{created.path}'.",
            {"path": created.path, "file_id": str(created.id)},
        )


def _guess_content_type(filename: str) -> str:
    """Infer an upload's MIME type from its name.

    A browser upload arrives with the type the browser detected; a tool call
    carries only a path, and the type decides auto-ingestion eligibility — so an
    omitted type must be inferred or every agent upload would land as
    `application/octet-stream` and never be indexed. `mimetypes` does not know
    Markdown on every platform, hence the explicit entries.
    """
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    explicit = {"md": "text/markdown", "markdown": "text/markdown", "log": "text/plain"}
    if suffix in explicit:
        return explicit[suffix]
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


def _decode(arguments: UploadFileArguments) -> bytes:
    """Return the upload's raw bytes, raising `ValueError` on bad base64."""
    if arguments.encoding == "base64":
        try:
            return base64.b64decode(arguments.content, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError(
                "content is not valid base64; send text with encoding='utf8' instead."
            ) from exc
    return arguments.content.encode("utf-8")


def write_tools(context: McpToolContext) -> list[McpTool]:
    """Build the mutating file tools for a request."""
    return [UploadFileTool(context), DeleteFileTool(context), CreateFolderTool(context)]
