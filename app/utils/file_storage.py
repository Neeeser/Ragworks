"""File storage helpers for saving and removing uploads."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings


class FileStorage:
    """Persist and delete files under a configured storage path."""

    def __init__(self, base_path: Path | None = None) -> None:
        """Initialize storage and ensure the base directory exists."""
        settings = get_settings()
        self.base_path = base_path or settings.storage_path
        self.base_path.mkdir(parents=True, exist_ok=True)

    def resolve(self, relative_path: str) -> Path:
        """Return the absolute path for a storage-relative path.

        Refuses anything that escapes the storage root: these paths travel
        on pipeline items and (for derived assets) reach an HTTP route, so
        a `../` component is a read of an arbitrary host file.
        """
        candidate = (self.base_path / relative_path).resolve()
        root = self.base_path.resolve()
        if candidate != root and root not in candidate.parents:
            raise ValueError(f"Path '{relative_path}' escapes the storage root.")
        return candidate

    def relative_of(self, path: str | Path) -> str:
        """Return a stored absolute path as storage-relative.

        Stored file paths are absolute on disk, while anything that
        travels between processes or into a URL has to survive the storage
        root moving (a container remount), so the relative form is what
        gets recorded.
        """
        resolved = Path(path).resolve()
        return str(resolved.relative_to(self.base_path.resolve()))

    def read_bytes(self, relative_path: str) -> bytes:
        """Read a stored file's bytes by storage-relative path."""
        return self.resolve(relative_path).read_bytes()

    def write_bytes(self, data: bytes, relative_path: str) -> Path:
        """Write bytes to a relative path and return the destination."""
        destination = self.resolve(relative_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        return destination

    def derived_dir(self, collection_id: object, document_id: object) -> str:
        """Return the storage-relative directory holding a document's derived assets.

        Assets a pipeline produced (images pulled out of a PDF) live under
        the document rather than beside the upload, so purging them on
        delete or re-ingest is one directory rather than a search.
        """
        return f"collections/{collection_id}/derived/{document_id}"

    def delete_tree(self, relative_path: str) -> None:
        """Remove a stored directory and everything under it.

        Derived assets (images a pipeline extracted from a document) live
        in a per-document directory, so purging them on delete or
        re-ingest is one call rather than a walk the caller repeats.
        """
        try:
            target = self.resolve(relative_path)
        except ValueError:
            return
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)

    def save_stream(self, stream: BinaryIO, relative_path: str) -> Path:
        """Stream a binary file to the storage path and return the destination."""
        destination = self.base_path / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as out_file:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                out_file.write(chunk)
        return destination

    def write_text(self, text: str, relative_path: str) -> Path:
        """Write text content to a relative file path and return the destination."""
        destination = self.base_path / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8")
        return destination

    def delete_path(self, target_path: str | Path | None) -> None:
        """Remove a stored file and clean up empty parent directories."""
        if not target_path:
            return
        path = Path(target_path)
        if not path.is_absolute():
            path = self.base_path / path
        try:
            path.relative_to(self.base_path)
        except ValueError:
            return
        if path.exists():
            path.unlink()
        parent = path.parent
        while parent != self.base_path and parent.is_dir():
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
