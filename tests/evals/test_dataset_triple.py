"""Record validation and modality derivation on the eval dataset triple."""

from __future__ import annotations

import pytest

from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
from app.pipelines.payloads import MediaAsset
from app.services.errors import InvalidInputError

PAGE_IMAGE = MediaAsset(
    media_type="image/png", path="eval_datasets/x/docs/d1.png", byte_size=42, width=8, height=6
)
PAGE_PDF = MediaAsset(media_type="application/pdf", path="eval_datasets/x/docs/d1.pdf", byte_size=9)


def _triple(corpus: list[CorpusDoc], queries: list[QueryRecord]) -> DatasetTriple:
    return DatasetTriple(
        name="set",
        corpus=corpus,
        queries=queries,
        qrels=[Qrel(query_external_id="q1", doc_external_id="d1")],
    )


def test_corpus_document_needs_text_or_media() -> None:
    """A document carrying neither is unevaluatable and is rejected at build."""
    with pytest.raises(InvalidInputError) as excinfo:
        CorpusDoc(external_doc_id="d1")
    assert "d1" in str(excinfo.value)


def test_query_needs_text_or_media() -> None:
    """A query carrying neither asks nothing, so it never reaches a run."""
    with pytest.raises(InvalidInputError) as excinfo:
        QueryRecord(external_query_id="q1")
    assert "q1" in str(excinfo.value)


def test_a_record_may_carry_both_text_and_media() -> None:
    """A page image beside its summary is one record, not two."""
    doc = CorpusDoc(external_doc_id="d1", text="page summary", media=PAGE_IMAGE)
    assert doc.text == "page summary"
    assert doc.media == PAGE_IMAGE


def test_text_only_triple_reports_the_text_modality() -> None:
    """A BEIR-shaped triple keeps reporting exactly one modality."""
    triple = _triple(
        [CorpusDoc(external_doc_id="d1", text="alpha")],
        [QueryRecord(external_query_id="q1", text="what is alpha")],
    )
    assert triple.modalities == frozenset({"text"})


def test_image_only_triple_reports_the_image_modality() -> None:
    """A page-image corpus with image queries carries no text at all."""
    triple = _triple(
        [CorpusDoc(external_doc_id="d1", media=PAGE_IMAGE)],
        [QueryRecord(external_query_id="q1", media=PAGE_IMAGE)],
    )
    assert triple.modalities == frozenset({"image"})


def test_mixed_triple_reports_both_modalities() -> None:
    """Text queries over a page-image corpus is the common benchmark shape."""
    triple = _triple(
        [CorpusDoc(external_doc_id="d1", media=PAGE_IMAGE)],
        [QueryRecord(external_query_id="q1", text="which page shows revenue")],
    )
    assert triple.modalities == frozenset({"text", "image"})


def test_media_outside_the_vocabulary_contributes_no_modality() -> None:
    """A PDF is neither modality, so it adds nothing the UI cannot render."""
    triple = _triple(
        [CorpusDoc(external_doc_id="d1", media=PAGE_PDF)],
        [QueryRecord(external_query_id="q1", text="what is alpha")],
    )
    assert triple.modalities == frozenset({"text"})


def test_modalities_cannot_be_supplied_by_the_caller() -> None:
    """Modalities are derived, so no source can claim a corpus it lacks."""
    with pytest.raises(TypeError):
        DatasetTriple(  # type: ignore[call-arg]
            name="set",
            corpus=[CorpusDoc(external_doc_id="d1", text="alpha")],
            queries=[QueryRecord(external_query_id="q1", text="q")],
            qrels=[],
            modalities=frozenset({"image"}),
        )
