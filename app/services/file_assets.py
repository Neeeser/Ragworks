"""Serving stored assets, and the size ceilings uploads answer to.

Split from `files.py`: asset resolution answers a different question than
the file tree — where bytes a *client* references live, and whether that
reference is inside the scope whose ownership the route checked.
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from app.schemas.content_types import IMAGE_CONTENT_TYPES
from app.services.app_config import get_app_config
from app.services.errors import NotFoundError
from app.utils.file_storage import FileStorage


def resolve_collection_asset(storage: FileStorage, collection_id: UUID, asset_path: str) -> Path:
    """Resolve an asset path scoped to one collection's directory."""
    return resolve_scoped_asset(storage, f"collections/{collection_id}/", asset_path)


def resolve_chat_asset(storage: FileStorage, session_id: UUID, asset_path: str) -> Path:
    """Resolve an asset path scoped to one chat session's directory."""
    return resolve_scoped_asset(storage, f"chat/{session_id}/", asset_path)


def resolve_scoped_asset(storage: FileStorage, prefix: str, asset_path: str) -> Path:
    """Resolve a storage-relative asset path against its owner's directory.

    Asset paths travel to the client (retrieval-match metadata, chat
    attachment records), which hands one back to fetch the bytes. The
    prefix is the authorization boundary: ownership of the *scope* — a
    collection, a chat session — is what the route checked, so a path
    pointing anywhere else is refused before the filesystem is consulted.
    Containment is decided on the *resolved* path, never a string prefix
    test: `collections/<mine>/../<victim>/...` passes the string test
    while resolving into another scope's directory. `storage.resolve`
    separately refuses anything escaping the storage root.
    """
    if not asset_path.startswith(prefix):
        raise NotFoundError(f"Asset not found: {asset_path}")
    try:
        resolved = storage.resolve(asset_path)
        scope_root = storage.resolve(prefix)
    except ValueError as exc:
        raise NotFoundError(f"Asset not found: {asset_path}") from exc
    if not resolved.is_relative_to(scope_root):
        raise NotFoundError(f"Asset not found: {asset_path}")
    if not resolved.is_file():
        raise NotFoundError(f"Asset not found: {asset_path}")
    return resolved


def upload_size_limit_mb(content_type: str | None) -> int:
    """The upload ceiling for one file, chosen by its category.

    Images get their own limit because their cost recurs: an image's bytes
    are inlined into model requests on every describe or embed, where a
    document's size is paid once at parse time.
    """
    uploads = get_app_config().uploads
    if content_type and content_type.lower() in IMAGE_CONTENT_TYPES:
        return uploads.max_image_upload_size_mb
    return uploads.max_upload_size_mb
