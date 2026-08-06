"""Handler protocols shared by the parser capability registries.

Parsing is organized by *capability* — extract text, extract embedded
media, render pages as images, read the file as media — and each
capability owns a registry keyed by content type. A parse node dispatches
on the file's content type and follows its own policy when the registry
answers nothing, so supporting a new format is a registry entry rather
than a change to any pipeline's shape.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.retrieval.parsers.media import ExtractedImage


@dataclass(frozen=True)
class TextRequest:
    """One file to extract text from, with the node's decode settings."""

    path: Path
    encoding: str


class TextHandler(Protocol):
    """Extracts a document's text content."""

    def extract(self, request: TextRequest) -> str:
        """Return the file's text, empty when it carries none."""
        ...


@dataclass(frozen=True)
class EmbeddedMediaRequest:
    """One container file to pull embedded media out of."""

    path: Path
    min_width: int
    min_height: int


class EmbeddedMediaHandler(Protocol):
    """Pulls the media embedded inside a container format."""

    def extract(self, request: EmbeddedMediaRequest) -> list[ExtractedImage]:
        """Return the embedded images, in document order."""
        ...


@dataclass(frozen=True)
class PageImageRequest:
    """One paginated file to rasterize, page by page."""

    path: Path
    dpi: int
    max_pages: int | None


class PageImageHandler(Protocol):
    """Rasterizes a paginated document to one image per page."""

    def render(self, request: PageImageRequest) -> list[ExtractedImage]:
        """Return one rendered image per page, in page order."""
        ...
