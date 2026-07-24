"""Path helpers shared by the file MCP tools.

Agents address files by human-readable path (`notes/spec.md`), never by UUID, so
every file tool resolves paths through `FileSystemService.resolve_path` — the
same helper the platform's own `ls`/`cd` surface uses. The collection root is
addressable as `/` or the empty string, which `resolve_path` deliberately
rejects (it resolves *nodes*), so the root case is handled here once.
"""

from __future__ import annotations

from app.db import models
from app.schemas.enums import FileNodeKind
from app.schemas.files import FileNodeRead
from app.services.errors import InvalidInputError
from app.services.files import FileSystemService

#: Root path spellings an agent may send.
_ROOT_PATHS = frozenset({"", "/", "."})


def is_root(path: str) -> bool:
    """Return whether a path addresses the collection root."""
    return path.strip().strip("/") == "" or path.strip() in _ROOT_PATHS


def resolve_node(
    service: FileSystemService, collection: models.Collection, path: str
) -> models.FileNode:
    """Resolve a path to a node, raising `NotFoundError` when it is missing."""
    return service.resolve_path(collection, path)


def resolve_parent(
    service: FileSystemService, collection: models.Collection, path: str
) -> tuple[models.FileNode | None, str]:
    """Split a path into its parent folder (None = root) and final segment.

    Raises `InvalidInputError` when the path has no final segment, and
    `NotFoundError` when the parent folder does not exist — the parent is never
    created implicitly, so a typo cannot scatter empty folders.
    """
    segments = [segment for segment in path.split("/") if segment]
    if not segments:
        raise InvalidInputError("A file or folder path is required.")
    name = segments[-1]
    if len(segments) == 1:
        return None, name
    parent = service.resolve_path(collection, "/".join(segments[:-1]))
    if parent.kind != FileNodeKind.FOLDER:
        raise InvalidInputError(f"'{'/'.join(segments[:-1])}' is a file, not a folder.")
    return parent, name


def describe_entry(entry: FileNodeRead) -> str:
    """Render one listing entry as a single readable line."""
    if entry.kind == FileNodeKind.FOLDER:
        return f"{entry.path}/  (folder)"
    parts = [entry.path, f"{entry.size_bytes} bytes"]
    if entry.content_type:
        parts.append(entry.content_type)
    status = entry.ingestion.status if entry.ingestion else "not ingested"
    parts.append(f"ingestion: {status}")
    return "  ".join(parts)
