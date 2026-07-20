"""Behavior tests for the curated benchmark registry and BEIR zip loader.

The network fetch is injected, so these exercise the real extraction+parse path
against an in-memory BEIR-shaped zip without touching the network.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from app.evals.datasets.builtin import download_builtin, get_builtin, list_builtin, load_beir_zip
from app.services.errors import InvalidInputError, NotFoundError


def _beir_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("scifact/corpus.jsonl", '{"_id": "d1", "title": "T", "text": "alpha"}\n')
        archive.writestr("scifact/queries.jsonl", '{"_id": "q1", "text": "what is alpha"}\n')
        archive.writestr("scifact/qrels/test.tsv", "query-id\tcorpus-id\tscore\nq1\td1\t1\n")
    return buffer.getvalue()


def test_registry_lists_curated_datasets() -> None:
    """The registry exposes curated small benchmarks with advisory counts."""
    entries = list_builtin()
    assert entries
    keys = {entry.key for entry in entries}
    assert "scifact" in keys
    for entry in entries:
        assert entry.name
        assert entry.description
        assert entry.domain
        assert entry.measures
        assert entry.url
        # Every entry is its own per-dataset archive: importing one benchmark
        # never downloads the others.
        assert entry.url.endswith(f"{entry.key}.zip")


def test_get_builtin_rejects_unknown_key() -> None:
    """An unknown registry key is a NotFoundError."""
    with pytest.raises(NotFoundError):
        get_builtin("does-not-exist")


def test_load_beir_zip_parses_the_triple() -> None:
    """A BEIR-shaped zip extracts and parses into the dataset triple."""
    triple = load_beir_zip(_beir_zip(), name="SciFact")
    assert triple.name == "SciFact"
    assert [doc.external_doc_id for doc in triple.corpus] == ["d1"]
    assert [query.external_query_id for query in triple.queries] == ["q1"]
    assert triple.qrels[0].doc_external_id == "d1"


def test_download_builtin_uses_the_injected_fetcher() -> None:
    """download_builtin fetches by the entry's URL and parses the result."""
    fetched: list[str] = []

    def fake_fetch(url: str) -> bytes:
        fetched.append(url)
        return _beir_zip()

    entry = get_builtin("scifact")
    triple = download_builtin(entry, fetch=fake_fetch)
    assert fetched == [entry.url]
    assert triple.corpus[0].external_doc_id == "d1"


def test_load_beir_zip_rejects_a_zip_missing_corpus() -> None:
    """A zip without a corpus file is a clear input error."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("x/queries.jsonl", '{"_id": "q1", "text": "q"}\n')
    with pytest.raises(InvalidInputError):
        load_beir_zip(buffer.getvalue(), name="x")
