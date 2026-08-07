"""Corpus assembly for a generated dataset: reconstructed text and page files.

`build_corpus` is where a synthetic dataset decides what each source document
becomes. Exercised directly against real storage, because the behaviour worth
pinning is which bytes land where — a document with page images is
represented by the file its owner uploaded, since reconstructing its chunk
text yields a run of `[image: …]` placeholders nothing can retrieve against.
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from app.db import models
from app.evals.datasets.base import CorpusDoc
from app.evals.datasets.media import DatasetMediaStore
from app.evals.generation.persistence import build_corpus
from app.evals.generation.sources import DocumentChunks, SourceCollection
from app.schemas.enums import EvalModality
from app.utils.file_storage import FileStorage

PDF = b"%PDF-1.7 a real upload"


def _document(name: str, *, content_type: str, source_path: str | None) -> models.Document:
    """A document row carrying only what corpus assembly reads."""
    return models.Document(
        id=uuid4(),
        collection_id=uuid4(),
        user_id=uuid4(),
        name=name,
        content_type=content_type,
        source_path=source_path,
        embedding_model="qwen/qwen3-embedding-0.6b",
    )


def _chunk(text: str) -> models.DocumentChunkRecord:
    """A chunk row carrying only its text."""
    return models.DocumentChunkRecord(
        document_id=uuid4(),
        collection_id=uuid4(),
        chunk_index=0,
        text=text,
        embedding_model="qwen/qwen3-embedding-0.6b",
    )


def _build(
    tmp_path: Path, documents: list[models.Document], chunks: dict[str, DocumentChunks]
) -> tuple[list[CorpusDoc], UUID, Path]:
    """Assemble a corpus over a storage rooted at `tmp_path`."""
    storage = FileStorage(base_path=tmp_path)
    dataset_id = uuid4()
    source = SourceCollection(documents=documents, chunks=chunks, storage=storage)
    corpus = build_corpus(source, DatasetMediaStore(storage, dataset_id))
    return corpus, dataset_id, tmp_path


def test_a_text_document_keeps_its_reconstructed_text(tmp_path: Path) -> None:
    """The text path is unchanged: chunks are joined, nothing is copied."""
    doc = _document("notes.txt", content_type="text/plain", source_path=None)
    chunks = {str(doc.id): DocumentChunks(text=[_chunk("First half."), _chunk("Second half.")])}

    corpus, _, root = _build(tmp_path, [doc], chunks)

    assert len(corpus) == 1
    assert corpus[0].text == "First half.\n\nSecond half."
    assert corpus[0].media is None
    assert corpus[0].metadata["modality"] == EvalModality.TEXT.value
    assert not (root / "eval_datasets").exists()


def test_an_image_document_carries_its_uploaded_file(tmp_path: Path) -> None:
    """A page-image PDF is represented by the file, byte for byte."""
    storage = FileStorage(base_path=tmp_path)
    storage.write_bytes(PDF, "collections/c/files/deck")
    doc = _document("deck.pdf", content_type="application/pdf", source_path="collections/c/files/deck")
    chunks = {str(doc.id): DocumentChunks(images=[_chunk("[image: deck.pdf, page 1]")])}

    corpus, dataset_id, root = _build(tmp_path, [doc], chunks)

    asset = corpus[0].media
    assert asset is not None
    assert asset.media_type == "application/pdf"
    assert asset.path == f"eval_datasets/{dataset_id}/docs/{doc.id}.pdf"
    assert (root / asset.path).read_bytes() == PDF
    assert corpus[0].text is None
    assert corpus[0].metadata["modality"] == EvalModality.IMAGE.value


def test_a_mixed_document_keeps_both_sides(tmp_path: Path) -> None:
    """A PDF that produced text and pages travels as file plus text."""
    storage = FileStorage(base_path=tmp_path)
    storage.write_bytes(PDF, "collections/c/files/report")
    doc = _document(
        "report.pdf", content_type="application/pdf", source_path="collections/c/files/report"
    )
    chunks = {
        str(doc.id): DocumentChunks(
            text=[_chunk("Revenue grew nine percent.")],
            images=[_chunk("[image: report.pdf, page 4]")],
        )
    }

    corpus, _, _ = _build(tmp_path, [doc], chunks)

    assert corpus[0].text == "Revenue grew nine percent."
    assert corpus[0].media is not None


def test_placeholder_text_never_reaches_an_image_document(tmp_path: Path) -> None:
    """The `[image: …]` chunk text is not corpus text; only real text chunks are."""
    storage = FileStorage(base_path=tmp_path)
    storage.write_bytes(PDF, "collections/c/files/slides")
    doc = _document(
        "slides.pdf", content_type="application/pdf", source_path="collections/c/files/slides"
    )
    chunks = {
        str(doc.id): DocumentChunks(
            images=[_chunk("[image: slides.pdf, page 1]"), _chunk("[image: slides.pdf, page 2]")]
        )
    }

    corpus, _, _ = _build(tmp_path, [doc], chunks)

    assert corpus[0].text is None


def test_a_missing_upload_falls_back_to_text(tmp_path: Path) -> None:
    """An unreadable source file costs the media, never the whole dataset."""
    doc = _document(
        "gone.pdf", content_type="application/pdf", source_path="collections/c/files/gone"
    )
    chunks = {
        str(doc.id): DocumentChunks(
            text=[_chunk("Some extracted text.")], images=[_chunk("[image: gone.pdf, page 1]")]
        )
    }

    corpus, _, _ = _build(tmp_path, [doc], chunks)

    assert corpus[0].media is None
    assert corpus[0].text == "Some extracted text."


def test_a_document_with_neither_text_nor_media_is_dropped(tmp_path: Path) -> None:
    """A corpus document carrying nothing is unevaluatable, so it is left out."""
    doc = _document(
        "gone.pdf", content_type="application/pdf", source_path="collections/c/files/gone"
    )
    chunks = {str(doc.id): DocumentChunks(images=[_chunk("[image: gone.pdf, page 1]")])}

    corpus, _, _ = _build(tmp_path, [doc], chunks)

    assert corpus == []


def test_documents_keep_their_own_media(tmp_path: Path) -> None:
    """Two image documents write two files, each named for its own id."""
    storage = FileStorage(base_path=tmp_path)
    first = _document("a.pdf", content_type="application/pdf", source_path="collections/c/files/a")
    second = _document("b.pdf", content_type="application/pdf", source_path="collections/c/files/b")
    storage.write_bytes(b"first", "collections/c/files/a")
    storage.write_bytes(b"second", "collections/c/files/b")
    chunks = {
        str(first.id): DocumentChunks(images=[_chunk("[image: a.pdf, page 1]")]),
        str(second.id): DocumentChunks(images=[_chunk("[image: b.pdf, page 1]")]),
    }

    corpus, _, root = _build(tmp_path, [first, second], chunks)

    paths = {doc.external_doc_id: doc.media.path for doc in corpus if doc.media is not None}
    assert len(paths) == 2
    assert (root / paths[str(first.id)]).read_bytes() == b"first"
    assert (root / paths[str(second.id)]).read_bytes() == b"second"
