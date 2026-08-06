"""The parser capability registries and their handlers.

The registries are what a parse node dispatches through, so what matters
here is that a content type resolves to a handler that reads a real file
— and that the awkward inputs (an empty PDF page, an undecodable byte)
degrade rather than fail the document.
"""

from __future__ import annotations

import io
from pathlib import Path

import pytest
from PIL import Image

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
from app.retrieval.parsers.media import normalize_image
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


class _StubBitmap:
    def to_pil(self) -> Image.Image:
        return Image.new("RGB", (8, 8))


class _StubPage:
    def render(self, scale: float) -> _StubBitmap:
        del scale
        return _StubBitmap()


def test_a_page_pdfium_cannot_rasterize_is_skipped(monkeypatch, tmp_path: Path) -> None:
    """One corrupt page must not cost the rest of the document."""

    class _StubDocument:
        def __init__(self, _path: str) -> None:
            self.closed = False

        def __len__(self) -> int:
            return 2

        def __getitem__(self, index: int) -> _StubPage:
            if index == 0:
                raise RuntimeError("corrupt page")
            return _StubPage()

        def close(self) -> None:
            self.closed = True

    path = tmp_path / "broken.pdf"
    path.write_bytes(b"fake")
    monkeypatch.setattr("app.retrieval.parsers.page_images.pypdfium2.PdfDocument", _StubDocument)

    pages = list(
        PAGE_IMAGE_HANDLERS["application/pdf"].render(
            PageImageRequest(path=path, dpi=72, max_pages=None)
        )
    )

    assert [page.page for page in pages] == [2]


def test_a_document_pdfium_cannot_open_fails_the_file(monkeypatch, tmp_path: Path) -> None:
    """Per-page degradation stops at the file: an unreadable PDF raises."""

    def _refuse(_path: str) -> None:
        raise RuntimeError("not a PDF")

    path = tmp_path / "broken.pdf"
    path.write_bytes(b"fake")
    monkeypatch.setattr("app.retrieval.parsers.page_images.pypdfium2.PdfDocument", _refuse)

    with pytest.raises(RuntimeError, match="not a PDF"):
        list(
            PAGE_IMAGE_HANDLERS["application/pdf"].render(
                PageImageRequest(path=path, dpi=72, max_pages=None)
            )
        )


def test_a_page_whose_images_cannot_be_read_is_skipped(monkeypatch, tmp_path: Path) -> None:
    """pypdf raises a wide family on malformed image streams; the rest survive."""

    class _StubEmbedded:
        def __init__(self, data: bytes) -> None:
            self.data = data

    class _StubImagePage:
        def __init__(self, images: list[_StubEmbedded] | None) -> None:
            self._images = images

        @property
        def images(self) -> list[_StubEmbedded]:
            if self._images is None:
                raise ValueError("malformed XObject")
            return self._images

    class _StubReader:
        def __init__(self, _path: str) -> None:
            self.pages = [_StubImagePage(None), _StubImagePage([_StubEmbedded(_png_bytes())])]

    path = tmp_path / "images.pdf"
    path.write_bytes(b"fake")
    monkeypatch.setattr("app.retrieval.parsers.embedded_media.PdfReader", _StubReader)

    images = EMBEDDED_MEDIA_HANDLERS["application/pdf"].extract(
        EmbeddedMediaRequest(path=path, min_width=1, min_height=1)
    )

    assert [image.page for image in images] == [2]


def test_an_undecodable_image_is_dropped_rather_than_raised() -> None:
    """Page artifacts are routinely not images at all."""
    assert normalize_image(b"certainly not an image") is None


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (80, 80)).save(buffer, format="PNG")
    return buffer.getvalue()
