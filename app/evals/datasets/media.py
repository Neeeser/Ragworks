"""Stored bytes for one eval dataset's media.

A dataset record may carry an image instead of (or beside) its text — a
page-image benchmark, an uploaded dataset pairing a caption with a picture.
Those bytes live under one directory keyed by the dataset id, so removing a
dataset is one tree deletion; a per-row loop misses whatever a half-finished
import wrote before it stopped.

Loaders call `write` as they page rather than collecting a corpus in memory,
so the peak footprint of an import is one file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal
from uuid import UUID

from app.pipelines.image_assets import read_image_dimensions
from app.pipelines.payloads import MediaAsset
from app.schemas.content_types import extension_for, is_image_content_type, normalize_content_type
from app.services.errors import InvalidInputError
from app.services.file_assets import resolve_scoped_asset
from app.utils.file_storage import FileStorage


def resolve_dataset_media(storage: FileStorage, dataset_id: UUID, asset_path: str) -> Path:
    """Resolve a media path scoped to one dataset's directory.

    A dataset's stored records hand their `path` to the client, which hands
    it back to fetch the bytes. Ownership of the *dataset* is what the route
    checked, so the dataset's own directory is the authorization boundary.
    """
    return resolve_scoped_asset(storage, f"eval_datasets/{dataset_id}/", asset_path)

#: Which side of the triple a media file belongs to. Corpus documents and
#: queries carry independent external id spaces that can collide, so each
#: side gets its own directory.
MediaKind = Literal["docs", "queries"]


class DatasetMediaStore:
    """The media directory of one eval dataset."""

    def __init__(self, storage: FileStorage, dataset_id: UUID) -> None:
        """Bind the store to `dataset_id`'s media root under `storage`."""
        self._storage = storage
        self._root = f"eval_datasets/{dataset_id}"

    def write(
        self, kind: MediaKind, external_id: str, *, content_type: str, data: bytes
    ) -> MediaAsset:
        """Store one record's bytes and return the asset referencing them.

        A path already holding a file of the same byte count is left alone,
        so writing one record twice costs no disk write. That is the whole
        of the guarantee: a loader has already fetched the bytes by the time
        they reach this method, and every import mints a fresh dataset id, so
        nothing re-enters a directory it partly wrote.

        The asset records the normalized content type, since what a source
        declared (`Image/PNG`, a charset parameter) travels on to an upload
        and into provider requests that accept neither.
        """
        media_type = normalize_content_type(content_type)
        relative = self._path_for(kind, external_id, media_type)
        if not self._holds(relative, len(data)):
            self._storage.write_bytes(data, relative)
        width, height = (
            read_image_dimensions(data) if is_image_content_type(media_type) else (None, None)
        )
        return MediaAsset(
            media_type=media_type,
            path=relative,
            byte_size=len(data),
            width=width,
            height=height,
        )

    def purge(self) -> None:
        """Remove every media file this dataset stored."""
        self._storage.delete_tree(self._root)

    def _path_for(self, kind: MediaKind, external_id: str, content_type: str) -> str:
        """Build the storage-relative path a record's bytes are written to."""
        safe = external_id.replace("/", "_")
        if not safe:
            raise InvalidInputError("Dataset media record has an empty external id.")
        return f"{self._root}/{kind}/{safe}{extension_for(content_type)}"

    def _holds(self, relative: str, byte_size: int) -> bool:
        """True when `relative` already stores exactly `byte_size` bytes."""
        path = self._storage.resolve(relative)
        return path.is_file() and path.stat().st_size == byte_size
