from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile

from app.api.config import get_settings


class FileStorage:
    def __init__(self, base_path: Path | None = None) -> None:
        settings = get_settings()
        self.base_path = base_path or settings.storage_path
        self.base_path.mkdir(parents=True, exist_ok=True)

    def save_upload(self, upload: UploadFile, relative_path: str) -> Path:
        destination = self.base_path / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("wb") as out_file:
            while True:
                chunk = upload.file.read(1024 * 1024)
                if not chunk:
                    break
                out_file.write(chunk)
        return destination

    def write_text(self, text: str, relative_path: str) -> Path:
        destination = self.base_path / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="utf-8")
        return destination

    def delete_path(self, target_path: str | Path | None) -> None:
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
