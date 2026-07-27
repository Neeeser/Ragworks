"""PDF document parser."""

from __future__ import annotations

from pathlib import Path

from pypdf import PdfReader

from ..models import Document
from .base import DocumentParser, DocumentSource, build_document_from_source


class PdfToTextParser(DocumentParser):
    """Extract native text content from PDF documents."""

    def parse(self, source: DocumentSource) -> Document:
        """Parse a PDF file into a document."""
        path = Path(source.path)
        if not path.exists():
            raise FileNotFoundError(f"PDF file not found: {path}")

        reader = PdfReader(str(path))
        text_fragments: list[str] = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                text_fragments.append(page_text.strip())

        text = "\n\n".join(text_fragments)
        return build_document_from_source(source, text)
