"""Behavior tests for the curated benchmark registry and its two sources.

Both transports are injected, so these exercise the real dispatch and parse
paths against an in-memory BEIR zip and captured `/rows` pages without touching
the network.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest

from app.evals.datasets.builtin import (
    BeirZipSource,
    HuggingFaceSource,
    download_builtin,
    get_builtin,
    list_builtin,
    load_beir_zip,
)
from app.evals.datasets.media import DatasetMediaStore
from app.schemas.enums import EvalModality
from app.services.errors import InvalidInputError, NotFoundError
from app.utils.file_storage import FileStorage
from tests.evals.hf_fixtures import FixtureReader, load_pages


def _beir_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("scifact/corpus.jsonl", '{"_id": "d1", "title": "T", "text": "alpha"}\n')
        archive.writestr("scifact/queries.jsonl", '{"_id": "q1", "text": "what is alpha"}\n')
        archive.writestr("scifact/qrels/test.tsv", "query-id\tcorpus-id\tscore\nq1\td1\t1\n")
    return buffer.getvalue()


def _refuse_media(*_args: object, **_kwargs: object) -> None:
    """A media writer a text benchmark must never call."""
    raise AssertionError("A text benchmark wrote media.")


def test_registry_lists_curated_datasets() -> None:
    """Every entry carries the framing and the cost a user decides on."""
    entries = list_builtin()
    assert entries
    keys = {entry.key for entry in entries}
    assert "scifact" in keys
    for entry in entries:
        assert entry.name
        assert entry.description
        assert entry.domain
        assert entry.measures
        assert entry.license_name
        assert entry.approx_download_mb > 0
        assert set(entry.modalities) <= {modality.value for modality in EvalModality}
        if isinstance(entry.source, BeirZipSource):
            # Every entry is its own per-dataset archive: importing one
            # benchmark never downloads the others.
            assert entry.source.url.endswith(f"{entry.key}.zip")


def test_image_benchmarks_declare_the_image_modality() -> None:
    """A page-image benchmark is distinguishable before it is imported."""
    entry = get_builtin("vidore-economics-v2")
    assert entry.modalities == (EvalModality.IMAGE.value,)
    assert isinstance(entry.source, HuggingFaceSource)
    assert entry.source.query_language == "english"


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


def test_download_builtin_fetches_a_zip_source_by_url() -> None:
    """A BEIR entry downloads its archive and never writes media."""
    fetched: list[str] = []

    def fake_fetch(url: str) -> bytes:
        fetched.append(url)
        return _beir_zip()

    entry = get_builtin("scifact")
    assert isinstance(entry.source, BeirZipSource)
    triple = download_builtin(entry, write_media=_refuse_media, fetch=fake_fetch)

    assert fetched == [entry.source.url]
    assert triple.corpus[0].external_doc_id == "d1"


def test_download_builtin_reads_a_huggingface_source_through_its_reader(
    tmp_path: Path,
) -> None:
    """An image entry pages the datasets-server and stores what it reads."""
    store = DatasetMediaStore(FileStorage(base_path=tmp_path), uuid4())
    entry = get_builtin("vidore-economics-v2")

    triple = download_builtin(
        entry,
        write_media=store.write,
        reader=FixtureReader(load_pages("hf_rows_vidore.json")),
    )

    assert EvalModality.IMAGE.value in triple.modalities
    assert all(doc.media is not None for doc in triple.corpus)
    # The registry entry filters to English, so the French half is dropped.
    assert len(triple.queries) == 2


def test_load_beir_zip_rejects_a_zip_missing_corpus() -> None:
    """A zip without a corpus file is a clear input error."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("x/queries.jsonl", '{"_id": "q1", "text": "q"}\n')
    with pytest.raises(InvalidInputError):
        load_beir_zip(buffer.getvalue(), name="x")
