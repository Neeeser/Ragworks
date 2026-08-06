"""Text-extraction handlers, keyed by content type."""

from __future__ import annotations

from pypdf import PdfReader

from app.retrieval.parsers.base import TextHandler, TextRequest


class PdfTextHandler:
    """Extract the native text layer of a PDF, page by page."""

    def extract(self, request: TextRequest) -> str:
        """Return the PDF's text, with blank pages dropped."""
        reader = PdfReader(str(request.path))
        fragments = [
            page_text.strip()
            for page in reader.pages
            if (page_text := page.extract_text() or "").strip()
        ]
        return "\n\n".join(fragments)


class PlainTextHandler:
    """Decode a text file with the node's configured encoding."""

    def extract(self, request: TextRequest) -> str:
        """Return the decoded file contents."""
        return request.path.read_text(encoding=request.encoding)


def decode_best_effort(request: TextRequest) -> str:
    """Decode arbitrary bytes as text, replacing whatever does not decode.

    The fallback behind Extract Text's `plain_text` unknown-format policy:
    the user has said to treat unhandled types as text, so a byte the
    encoding cannot represent must not fail the document.
    """
    return request.path.read_bytes().decode(request.encoding, errors="replace")


TEXT_HANDLERS: dict[str, TextHandler] = {
    "application/pdf": PdfTextHandler(),
    "text/plain": PlainTextHandler(),
    "text/markdown": PlainTextHandler(),
    "text/csv": PlainTextHandler(),
}
