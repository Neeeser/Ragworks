"""Behavior tests for the custom-dataset (BEIR-format) upload parser."""

from __future__ import annotations

import pytest

from app.evals.datasets.upload import parse_beir_upload
from app.services.errors import InvalidInputError

CORPUS = (
    '{"_id": "d1", "title": "First", "text": "alpha beta"}\n'
    '{"_id": "d2", "title": "", "text": "gamma delta"}\n'
    "\n"  # blank lines are ignored
)
QUERIES = '{"_id": "q1", "text": "what is alpha"}\n{"_id": "q2", "text": "what is gamma"}\n'
QRELS = "query-id\tcorpus-id\tscore\nq1\td1\t1\nq2\td2\t2\n"


def test_parses_beir_triple() -> None:
    """A well-formed BEIR triple parses into the expected records."""
    triple = parse_beir_upload(
        name="My golden set", corpus=CORPUS, queries=QUERIES, qrels=QRELS
    )
    assert triple.name == "My golden set"
    assert len(triple.corpus) == 2
    assert triple.corpus[0].external_doc_id == "d1"
    assert triple.corpus[0].title == "First"
    assert len(triple.queries) == 2
    assert triple.queries[1].external_query_id == "q2"
    assert len(triple.qrels) == 2
    assert triple.qrels[1].doc_external_id == "d2"
    assert triple.qrels[1].relevance == 2


def test_qrels_header_is_optional() -> None:
    """A qrels file without the standard header still parses."""
    triple = parse_beir_upload(
        name="x", corpus=CORPUS, queries=QUERIES, qrels="q1\td1\t1\n"
    )
    assert len(triple.qrels) == 1
    assert triple.qrels[0].query_external_id == "q1"


def test_qrel_naming_a_doc_outside_the_corpus_is_rejected() -> None:
    """An unknown corpus-id is ground truth pointing at nothing — reject it."""
    with pytest.raises(InvalidInputError) as excinfo:
        parse_beir_upload(
            name="x", corpus=CORPUS, queries=QUERIES, qrels="q1\td-not-in-corpus\t1\n"
        )
    assert "d-not-in-corpus" in str(excinfo.value)


def test_qrel_naming_a_query_outside_the_queries_file_is_rejected() -> None:
    """An unknown query-id would score a query the dataset never asks."""
    with pytest.raises(InvalidInputError) as excinfo:
        parse_beir_upload(
            name="x", corpus=CORPUS, queries=QUERIES, qrels="q-nope\td1\t1\n"
        )
    assert "q-nope" in str(excinfo.value)


def test_qrel_outside_the_corpus_is_kept_when_not_strict() -> None:
    """The builtin-download path (`load_beir_zip`) parses leniently.

    A published BEIR archive is not something the user can repair, so a
    dangling judgment must not fail the whole import; the sampling layer
    drops gold docs absent from the sampled corpus.
    """
    triple = parse_beir_upload(
        name="x",
        corpus=CORPUS,
        queries=QUERIES,
        qrels="q1\td-not-in-corpus\t1\n",
        strict=False,
    )
    assert len(triple.qrels) == 1
    assert triple.qrels[0].doc_external_id == "d-not-in-corpus"


def test_missing_text_is_tolerated_when_not_strict() -> None:
    """A published archive row with no text imports as an empty document."""
    triple = parse_beir_upload(
        name="x",
        corpus='{"_id": "d1", "title": "First"}\n',
        queries=QUERIES,
        qrels="",
        strict=False,
    )
    assert triple.corpus[0].text == ""


def test_query_with_no_qrels_rows_is_legal() -> None:
    """Zero qrels rows is the BEIR encoding of 'no gold document'."""
    triple = parse_beir_upload(
        name="x", corpus=CORPUS, queries=QUERIES, qrels="q1\td1\t1\n"
    )
    assert len(triple.qrels) == 1


def test_corpus_row_without_text_is_rejected() -> None:
    """A corpus row with no text would ingest and index an empty document."""
    with pytest.raises(InvalidInputError) as excinfo:
        parse_beir_upload(
            name="x", corpus='{"_id": "d1", "title": "First"}\n', queries=QUERIES, qrels=""
        )
    assert "d1" in str(excinfo.value)


def test_corpus_row_with_blank_text_is_rejected() -> None:
    """Whitespace-only text carries no content to retrieve."""
    with pytest.raises(InvalidInputError):
        parse_beir_upload(
            name="x", corpus='{"_id": "d1", "text": "   "}\n', queries=QUERIES, qrels=""
        )


def test_corpus_row_with_non_string_text_is_rejected() -> None:
    """A numeric text field is malformed input, not a document to stringify."""
    with pytest.raises(InvalidInputError):
        parse_beir_upload(
            name="x", corpus='{"_id": "d1", "text": 42}\n', queries=QUERIES, qrels=""
        )


def test_query_row_without_text_is_rejected() -> None:
    """A query with no text cannot be run against the index."""
    with pytest.raises(InvalidInputError) as excinfo:
        parse_beir_upload(
            name="x", corpus=CORPUS, queries='{"_id": "q1"}\n', qrels=""
        )
    assert "q1" in str(excinfo.value)


def test_missing_id_is_rejected() -> None:
    """A corpus row without an id is a clear input error, not a silent drop."""
    with pytest.raises(InvalidInputError):
        parse_beir_upload(
            name="x",
            corpus='{"text": "no id here"}\n',
            queries=QUERIES,
            qrels=QRELS,
        )


def test_malformed_json_is_rejected() -> None:
    """A non-JSON corpus line raises rather than corrupting the dataset."""
    with pytest.raises(InvalidInputError):
        parse_beir_upload(name="x", corpus="not json\n", queries=QUERIES, qrels=QRELS)


def test_empty_corpus_or_queries_is_rejected() -> None:
    """A dataset with no corpus or no queries cannot be evaluated against."""
    with pytest.raises(InvalidInputError):
        parse_beir_upload(name="x", corpus="", queries=QUERIES, qrels=QRELS)
    with pytest.raises(InvalidInputError):
        parse_beir_upload(name="x", corpus=CORPUS, queries="", qrels=QRELS)
