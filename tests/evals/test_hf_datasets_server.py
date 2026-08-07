"""The HuggingFace datasets-server loader, against captured `/rows` pages.

Two dialects ship in the registry — ViDoRe v2 (`doc-id`, multilingual queries)
and REAL-MM-RAG (`image_filename`, one language) — and the loader has to read
both. The HTTP client's own behavior (rate limiting, media typing, error
translation) is driven through `httpx.MockTransport`, the boundary we do not
own.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from app.evals.datasets.base import DatasetTriple
from app.evals.datasets.hf_datasets_server import (
    MAX_PAGE_ROWS,
    HuggingFaceRowsClient,
    ProgressCallback,
    RowEnvelope,
    RowsPage,
    load_huggingface_triple,
    media_type_from_url,
)
from app.evals.datasets.media import DatasetMediaStore
from app.schemas.enums import EvalModality
from app.services.errors import ExternalServiceError, InvalidInputError
from app.utils.file_storage import FileStorage
from tests.evals.hf_fixtures import IMAGE_BYTES, FixtureReader, load_pages

RATE_LIMIT_HTML = (
    "<html><head><title>429 Too Many Requests</title></head>"
    "<body><h1>Too Many Requests</h1></body></html>"
)


def _store(tmp_path: Path) -> DatasetMediaStore:
    return DatasetMediaStore(FileStorage(base_path=tmp_path), uuid4())


def _load(
    reader: FixtureReader,
    tmp_path: Path,
    *,
    query_language: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> DatasetTriple:
    store = _store(tmp_path)
    return load_huggingface_triple(
        reader,
        name="Benchmark",
        write_media=store.write,
        query_language=query_language,
        on_progress=on_progress,
    )


# --------------------------------------------------------------------------- #
# Column dialects
# --------------------------------------------------------------------------- #


def test_vidore_dialect_loads_page_images_and_metadata(tmp_path: Path) -> None:
    """ViDoRe corpus rows carry an integer id, an image, and a source doc id."""
    reader = FixtureReader(load_pages("hf_rows_vidore.json"))

    triple = _load(reader, tmp_path)

    assert [doc.external_doc_id for doc in triple.corpus] == ["0", "1"]
    first = triple.corpus[0]
    assert first.media is not None
    assert first.media.media_type == "image/jpeg"
    assert first.text is None
    assert first.metadata["doc-id"] == "global-economic-prospects-june-2024"
    # Image pages asked about in writing: the dataset carries both.
    assert triple.modalities == frozenset(
        {EvalModality.IMAGE.value, EvalModality.TEXT.value}
    )


def test_real_mm_rag_dialect_loads_its_own_columns(tmp_path: Path) -> None:
    """REAL-MM-RAG names its page file rather than only its source document."""
    reader = FixtureReader(load_pages("hf_rows_real_mm_rag.json"))

    triple = _load(reader, tmp_path)

    assert [doc.external_doc_id for doc in triple.corpus] == ["0", "1"]
    assert triple.corpus[0].metadata["image_filename"] == "ibm-1q17-earnings-charts_page_15"
    assert [qrel.doc_external_id for qrel in triple.qrels] == ["0", "1"]
    assert triple.qrels[0].relevance == 1


def test_image_bytes_are_written_as_each_page_is_read(tmp_path: Path) -> None:
    """Bytes reach disk during the page that referenced them.

    A pre-signed URL expires an hour after its page was served, so collecting
    URLs and fetching them afterwards fails on a long import.
    """
    store = _store(tmp_path)
    written: list[str] = []
    reader = FixtureReader(load_pages("hf_rows_vidore.json"))

    def record(kind, external_id, *, content_type, data):
        written.append(external_id)
        assert reader.fetched, "the image was written before it was fetched"
        return store.write(kind, external_id, content_type=content_type, data=data)

    triple = load_huggingface_triple(reader, name="B", write_media=record)

    assert written == ["0", "1"]
    asset = triple.corpus[0].media
    assert asset is not None
    assert (tmp_path / asset.path).read_bytes() == IMAGE_BYTES
    assert (asset.width, asset.height) == (200, 120)


# --------------------------------------------------------------------------- #
# Paging
# --------------------------------------------------------------------------- #


def _synthetic_pages(corpus_rows: int, declared_total: int) -> dict[str, RowsPage]:
    """Build a corpus of `corpus_rows` text rows declaring `declared_total`."""
    rows = [
        RowEnvelope(row_idx=index, row={"corpus-id": index, "text": f"row {index}"})
        for index in range(corpus_rows)
    ]
    empty = RowsPage(rows=[], num_rows_total=0)
    return {
        "corpus": RowsPage(rows=rows, num_rows_total=declared_total),
        "queries": empty,
        "qrels": empty,
    }


def test_paging_advances_by_rows_returned_and_stops_at_the_total(tmp_path: Path) -> None:
    """A multi-page corpus is read once, in order, and then stops."""
    reader = FixtureReader(_synthetic_pages(250, 250))

    triple = _load(reader, tmp_path)

    corpus_requests = [request for request in reader.requests if request[0] == "corpus"]
    assert corpus_requests == [
        ("corpus", 0, MAX_PAGE_ROWS),
        ("corpus", 100, MAX_PAGE_ROWS),
        ("corpus", 200, MAX_PAGE_ROWS),
    ]
    assert len(triple.corpus) == 250


def test_over_reading_the_end_terminates_instead_of_looping(tmp_path: Path) -> None:
    """A page smaller than the one asked for is the split's last page.

    Trusting `num_rows_total` alone would keep asking for rows past the last
    one a dataset with a stale reported count serves.
    """
    reader = FixtureReader(_synthetic_pages(120, 400))

    triple = _load(reader, tmp_path)

    corpus_requests = [request for request in reader.requests if request[0] == "corpus"]
    assert corpus_requests == [("corpus", 0, MAX_PAGE_ROWS), ("corpus", 100, MAX_PAGE_ROWS)]
    assert len(triple.corpus) == 120


def test_a_stale_total_over_a_whole_number_of_pages_stops_on_the_empty_page(
    tmp_path: Path,
) -> None:
    """A split ending exactly on a page boundary serves no short page at all.

    The last full page looks like every other one, so termination there rests
    on the next request coming back empty.
    """
    reader = FixtureReader(_synthetic_pages(200, 400))

    triple = _load(reader, tmp_path)

    corpus_requests = [request for request in reader.requests if request[0] == "corpus"]
    assert corpus_requests == [
        ("corpus", 0, MAX_PAGE_ROWS),
        ("corpus", 100, MAX_PAGE_ROWS),
        ("corpus", 200, MAX_PAGE_ROWS),
    ]
    assert len(triple.corpus) == 200


def test_progress_reports_the_corpus_size_from_the_first_page(tmp_path: Path) -> None:
    """Progress is (fetched, total) per page, so an import can be watched."""
    reader = FixtureReader(_synthetic_pages(250, 250))
    seen: list[tuple[int, int]] = []

    _load(reader, tmp_path, on_progress=lambda done, total: seen.append((done, total)))

    assert seen == [(100, 250), (200, 250), (250, 250)]


# --------------------------------------------------------------------------- #
# The language filter
# --------------------------------------------------------------------------- #


def test_language_filter_keeps_one_question_set(tmp_path: Path) -> None:
    """A multilingual benchmark repeats one question set per language."""
    reader = FixtureReader(load_pages("hf_rows_vidore.json"))

    triple = _load(reader, tmp_path, query_language="english")

    assert [query.external_query_id for query in triple.queries] == ["21", "22"]


def test_filtered_queries_take_their_qrels_with_them(tmp_path: Path) -> None:
    """A judgment whose query was dropped would score against nothing."""
    reader = FixtureReader(load_pages("hf_rows_vidore.json"))

    unfiltered = _load(reader, tmp_path)
    filtered = _load(
        FixtureReader(load_pages("hf_rows_vidore.json")), tmp_path, query_language="english"
    )

    assert {qrel.query_external_id for qrel in unfiltered.qrels} == {"21", "22", "58"}
    assert {qrel.query_external_id for qrel in filtered.qrels} == {"21", "22"}


def test_a_row_without_a_usable_id_is_rejected(tmp_path: Path) -> None:
    """A corpus row with no id would index under an empty name."""
    pages = _synthetic_pages(1, 1)
    pages["corpus"].rows[0].row.pop("corpus-id")
    with pytest.raises(InvalidInputError):
        _load(FixtureReader(pages), tmp_path)


# --------------------------------------------------------------------------- #
# The HTTP client
# --------------------------------------------------------------------------- #


def _client(handler, **kwargs) -> HuggingFaceRowsClient:
    return HuggingFaceRowsClient(
        "vidore/economics_reports_v2",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        sleep=lambda _seconds: None,
        **kwargs,
    )


def test_rate_limit_html_is_reported_as_a_rate_limit() -> None:
    """The 429 body is CDN HTML: parsing it as JSON hides the real cause."""
    attempts: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request)
        return httpx.Response(429, text=RATE_LIMIT_HTML)

    with pytest.raises(ExternalServiceError, match="rate limiting"):
        _client(handler).rows("corpus", 0, MAX_PAGE_ROWS)

    # Three backoffs then one last attempt.
    assert len(attempts) == 4


def test_a_rate_limit_that_clears_is_retried() -> None:
    """The import survives a burst rather than failing the whole download."""
    responses = [httpx.Response(429, text=RATE_LIMIT_HTML)]

    def handler(request: httpx.Request) -> httpx.Response:
        if responses:
            return responses.pop()
        return httpx.Response(
            200, json={"rows": [{"row_idx": 0, "row": {"corpus-id": 7}}], "num_rows_total": 1}
        )

    page = _client(handler).rows("corpus", 0, MAX_PAGE_ROWS)

    assert page.num_rows_total == 1


def test_the_page_request_carries_the_dataset_config_and_window() -> None:
    """The query string is the API's contract; `length` never exceeds the cap."""
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json={"rows": [], "num_rows_total": 0})

    _client(handler).rows("queries", 200, 500)

    params = seen[0].params
    assert params["dataset"] == "vidore/economics_reports_v2"
    assert params["config"] == "queries"
    assert params["split"] == "test"
    assert params["offset"] == "200"
    assert params["length"] == str(MAX_PAGE_ROWS)


def test_a_server_error_becomes_an_external_service_error() -> None:
    """An upstream fault is classified, never surfaced as a raw HTTP error."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="unavailable")

    with pytest.raises(ExternalServiceError):
        _client(handler).rows("corpus", 0, MAX_PAGE_ROWS)


def test_a_body_that_is_not_a_page_is_an_external_service_error() -> None:
    """A 200 carrying something else must not raise a bare decode error."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>maintenance</html>")

    with pytest.raises(ExternalServiceError, match="unreadable"):
        _client(handler).rows("corpus", 0, MAX_PAGE_ROWS)


def test_media_type_comes_from_the_url_not_the_header() -> None:
    """The asset response declares `binary/octet-stream` for every image."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=IMAGE_BYTES, headers={"content-type": "binary/octet-stream"}
        )

    media_type, data = _client(handler).media("https://cdn.example/x/image.jpg?Expires=1")

    assert media_type == "image/jpeg"
    assert data == IMAGE_BYTES


def test_an_unrecognized_suffix_still_names_the_bytes() -> None:
    """A suffix the catalog does not list stores rather than failing the import."""
    assert media_type_from_url("https://cdn.example/page.tiff") == "application/octet-stream"


def test_hf_token_authenticates_the_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """A configured token raises the anonymous per-IP rate-limit ceiling."""
    monkeypatch.setenv("HF_TOKEN", "hf_secret")
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("authorization"))
        return httpx.Response(200, json={"rows": [], "num_rows_total": 0})

    _client(handler).rows("corpus", 0, MAX_PAGE_ROWS)

    assert seen == ["Bearer hf_secret"]


def test_resume_skips_media_already_on_disk(tmp_path: Path) -> None:
    """A retried import re-fetches only what is missing.

    A 2280-page corpus otherwise restarts a 20-minute download from zero
    whenever a rate limit or a process restart interrupts it.
    """
    store = _store(tmp_path)
    first = load_huggingface_triple(
        FixtureReader(load_pages("hf_rows_vidore.json")), name="B", write_media=store.write
    )
    asset = first.corpus[0].media
    assert asset is not None
    stored = tmp_path / asset.path
    stored.write_bytes(b"S" * len(IMAGE_BYTES))

    load_huggingface_triple(
        FixtureReader(load_pages("hf_rows_vidore.json")), name="B", write_media=store.write
    )

    assert stored.read_bytes() == b"S" * len(IMAGE_BYTES)
