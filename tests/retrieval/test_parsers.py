from __future__ import annotations

from pathlib import Path

import pytest

from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers.base import DocumentSource
from app.retrieval.parsers.pdf import PdfToTextParser
from app.retrieval.parsers.txt import TxtDocumentParser


def test_txt_parser_reads_text(tmp_path: Path) -> None:
    path = tmp_path / "sample.txt"
    path.write_text("hello world", encoding="utf-8")
    source = DocumentSource(
        document_id="doc-1",
        path=path,
        metadata=DocumentMetadata(data={"source": "unit"}),
    )

    document = TxtDocumentParser().parse(source)

    assert document.text == "hello world"
    assert document.metadata.data == {"source": "unit"}


def test_txt_parser_raises_for_missing_file(tmp_path: Path) -> None:
    source = DocumentSource(document_id="doc-1", path=tmp_path / "missing.txt")

    with pytest.raises(FileNotFoundError):
        TxtDocumentParser().parse(source)


def test_pdf_parser_reads_sample_pdf() -> None:
    sample = Path(__file__).resolve().parents[1] / "assets" / "sample.pdf"
    source = DocumentSource(document_id="doc-1", path=sample, metadata=DocumentMetadata())

    document = PdfToTextParser().parse(source)

    assert "TransparentRAG" in document.text


def test_pdf_parser_raises_for_missing_file(tmp_path: Path) -> None:
    source = DocumentSource(document_id="doc-1", path=tmp_path / "missing.pdf")

    with pytest.raises(FileNotFoundError):
        PdfToTextParser().parse(source)


def test_pdf_parser_skips_empty_pages(monkeypatch, tmp_path: Path) -> None:
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
    source = DocumentSource(document_id="doc-1", path=path, metadata=DocumentMetadata())

    monkeypatch.setattr("app.retrieval.parsers.pdf.PdfReader", _StubReader)

    document = PdfToTextParser().parse(source)

    assert document.text == "Hello page"
