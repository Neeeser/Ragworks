"""Plain text document parser."""

from __future__ import annotations

from pathlib import Path

from ..models import Document
from .base import DocumentParser, DocumentSource, build_document_from_source


class TxtDocumentParser(DocumentParser):
    """Parse plain text files into Document instances."""

    def __init__(self, encoding: str = "utf-8") -> None:
        """Initialize the parser with the desired encoding."""
        self._encoding = encoding

    def parse(self, source: DocumentSource) -> Document:
        """Parse a text file into a document."""
        path = Path(source.path)
        if not path.exists():
            raise FileNotFoundError(f"Text file not found: {path}")

        text = path.read_text(encoding=self._encoding)
        return build_document_from_source(source, text)
