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


def test_qrel_referencing_a_doc_outside_the_corpus_is_kept_at_parse_time() -> None:
    """The parser does not cross-validate qrels against the corpus.

    BEIR qrels routinely reference documents the parser has no reason to reject
    here; the out-of-corpus drop is the sampling layer's job (it excludes gold
    docs absent from the sampled corpus). Rejecting them at parse time would
    make valid BEIR uploads fail, so parsing keeps every well-formed row.
    """
    triple = parse_beir_upload(
        name="x", corpus=CORPUS, queries=QUERIES, qrels="q1\td-not-in-corpus\t1\n"
    )
    assert len(triple.qrels) == 1
    assert triple.qrels[0].doc_external_id == "d-not-in-corpus"


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
