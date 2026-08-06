"""The parser capability registries and their handlers.

The registries are what a parse node dispatches through, so what matters
here is that a content type resolves to a handler that reads a real file
— and that the awkward inputs (an empty PDF page, an undecodable byte)
degrade rather than fail the document.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.retrieval.parsers import (
    EMBEDDED_MEDIA_HANDLERS,
    MEDIA_FILE_TYPES,
    PAGE_IMAGE_HANDLERS,
    TEXT_HANDLERS,
    EmbeddedMediaRequest,
    PageImageRequest,
    TextRequest,
    decode_best_effort,
)
from app.retrieval.parsers.page_images import PdfPageImageHandler

ASSETS = Path(__file__).resolve().parents[1] / "assets"


def _text(path: Path, encoding: str = "utf-8") -> TextRequest:
    return TextRequest(path=path, encoding=encoding)


def test_plain_text_handler_reads_a_text_file(tmp_path: Path) -> None:
    path = tmp_path / "sample.txt"
    path.write_text("hello world", encoding="utf-8")

    assert TEXT_HANDLERS["text/plain"].extract(_text(path)) == "hello world"


def test_a_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        TEXT_HANDLERS["text/plain"].extract(_text(tmp_path / "missing.txt"))


def test_pdf_handler_reads_the_native_text_layer() -> None:
    assert "Ragworks" in TEXT_HANDLERS["application/pdf"].extract(_text(ASSETS / "sample.pdf"))


def test_pdf_handler_skips_empty_pages(monkeypatch, tmp_path: Path) -> None:
    class _StubPage:
        def __init__(self, text: str | None) -> None:
            self._text = text

        def extract_text(self):
            return self._text

    class _StubReader:
        def __init__(self, _path: str) -> None:
            self.pages = [_StubPage(" "), _StubPage("Hello page")]

    path = tmp_path / "sample.pdf"
    path.write_text("fake", encoding="utf-8")
    monkeypatch.setattr("app.retrieval.parsers.text.PdfReader", _StubReader)

    assert TEXT_HANDLERS["application/pdf"].extract(_text(path)) == "Hello page"


def test_best_effort_decoding_replaces_what_the_encoding_cannot_read(tmp_path: Path) -> None:
    """The plain_text policy must never fail a document over one bad byte."""
    path = tmp_path / "binary.bin"
    path.write_bytes(b"ok\xff\xfetail")

    decoded = decode_best_effort(_text(path))

    assert decoded.startswith("ok")
    assert decoded.endswith("tail")


def test_embedded_media_handler_pulls_images_above_the_floor() -> None:
    images = EMBEDDED_MEDIA_HANDLERS["application/pdf"].extract(
        EmbeddedMediaRequest(path=ASSETS / "images.pdf", min_width=64, min_height=64)
    )

    assert [(image.width, image.height) for image in images] == [(480, 320)]
    assert images[0].page == 1


def test_page_image_handler_renders_every_page() -> None:
    pages = PAGE_IMAGE_HANDLERS["application/pdf"].render(
        PageImageRequest(path=ASSETS / "images.pdf", dpi=72, max_pages=None)
    )

    assert [page.page for page in pages] == [1, 2]
    assert all(page.data.startswith(b"\x89PNG") for page in pages)
    assert all(page.media_type == "image/png" for page in pages)


def test_page_image_handler_honours_the_page_cap() -> None:
    pages = PAGE_IMAGE_HANDLERS["application/pdf"].render(
        PageImageRequest(path=ASSETS / "images.pdf", dpi=72, max_pages=1)
    )

    assert len(list(pages)) == 1


def test_pages_are_rendered_one_at_a_time(monkeypatch) -> None:
    """Peak memory is one page: a long PDF is never held as whole PNGs."""
    rendered: list[int] = []
    render_page = PdfPageImageHandler._render_page

    def _counting(document, index, dpi):
        rendered.append(index)
        return render_page(document, index, dpi)

    monkeypatch.setattr(PdfPageImageHandler, "_render_page", staticmethod(_counting))

    pages = PAGE_IMAGE_HANDLERS["application/pdf"].render(
        PageImageRequest(path=ASSETS / "images.pdf", dpi=72, max_pages=None)
    )
    first = next(iter(pages))

    assert first.page == 1
    assert rendered == [0]


def test_media_file_types_are_the_image_content_types() -> None:
    assert "image/png" in MEDIA_FILE_TYPES
    assert "application/pdf" not in MEDIA_FILE_TYPES
