"""Load a BEIR triple from the HuggingFace datasets-server rows API.

Plain `httpx`, no `datasets`/`pyarrow` dependency — the same stance the BEIR zip
loader takes, so an offline deployment simply cannot fetch a new benchmark
rather than failing to import.

The API serves `GET /rows?dataset=…&config=corpus|queries|qrels&split=…` in
pages of at most 100 rows. Image columns are *not* bytes: a cell is a
pre-signed CloudFront URL that expires an hour after the page was served, so
this module fetches every page's images while reading that page and hands them
straight to a `MediaWriter`. Nothing but the current page's bytes is ever held.
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ValidationError

from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
from app.evals.datasets.media import MediaKind
from app.pipelines.payloads import MediaAsset
from app.schemas.content_types import KNOWN_CONTENT_TYPES
from app.services.errors import ExternalServiceError, InvalidInputError

ROWS_URL = "https://datasets-server.huggingface.co/rows"

#: The API's hard page cap; asking for more is a client error, not a bigger page.
MAX_PAGE_ROWS = 100

#: Anonymous callers get roughly 500 requests per 5 minutes per IP, and the 429
#: arrives from the CDN with an HTML body and no `Retry-After`, so the pace and
#: the retry schedule are both ours to choose.
_MIN_REQUEST_INTERVAL_SECONDS = 0.6
_BACKOFF_SECONDS: tuple[float, ...] = (5.0, 15.0, 45.0)
_TIMEOUT_SECONDS = 60.0
_TOO_MANY_REQUESTS = 429

_CORPUS_ID = "corpus-id"
_QUERY_ID = "query-id"
_QUERY_TEXT = "query"
_LANGUAGE = "language"
_SCORE = "score"
_IMAGE = "image"
_TEXT = "text"

#: An image response declares `binary/octet-stream`, so the URL's own suffix is
#: the only statement of what the bytes are.
_URL_MEDIA_TYPES: Mapping[str, str] = {
    **{option.extension: option.value for option in KNOWN_CONTENT_TYPES},
    ".jpeg": "image/jpeg",
}
_UNKNOWN_MEDIA_TYPE = "application/octet-stream"


class ImageCell(BaseModel):
    """One image column value: a pre-signed URL plus the image's pixel size."""

    src: str
    width: int | None = None
    height: int | None = None


class RowEnvelope(BaseModel):
    """One row of a page: its index in the split plus its column values."""

    row_idx: int
    row: dict[str, object]


class RowsPage(BaseModel):
    """One page of `/rows`, plus how many rows the whole split holds."""

    rows: list[RowEnvelope]
    num_rows_total: int


class RowsReader(Protocol):
    """Reads dataset pages and the media each page references."""

    def rows(self, config: str, offset: int, length: int) -> RowsPage:
        """Return one page of a config's rows starting at `offset`."""
        ...

    def media(self, url: str) -> tuple[str, bytes]:
        """Fetch one referenced asset, returning its media type and bytes."""
        ...


class MediaWriter(Protocol):
    """Stores one record's bytes and returns the asset referencing them."""

    def __call__(
        self, kind: MediaKind, external_id: str, *, content_type: str, data: bytes
    ) -> MediaAsset:
        """Persist `data` for one record of the triple."""
        ...


ProgressCallback = Callable[[int, int], None]


class HuggingFaceRowsClient:
    """An HTTP reader for one dataset on the datasets-server."""

    def __init__(
        self,
        repo_id: str,
        split: str = "test",
        *,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        """Bind the reader to one dataset repo and split."""
        self._repo_id = repo_id
        self._split = split
        self._client = client or httpx.Client(timeout=_TIMEOUT_SECONDS, follow_redirects=True)
        self._sleep = sleep
        self._last_request_at: float | None = None

    def rows(self, config: str, offset: int, length: int) -> RowsPage:
        """Return one page of rows, rejecting a request over the API's cap."""
        response = self._get(
            ROWS_URL,
            {
                "dataset": self._repo_id,
                "config": config,
                "split": self._split,
                "offset": str(offset),
                "length": str(min(length, MAX_PAGE_ROWS)),
            },
        )
        try:
            return RowsPage.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise ExternalServiceError(
                f"The datasets-server returned an unreadable page for '{self._repo_id}': {exc}"
            ) from exc

    def media(self, url: str) -> tuple[str, bytes]:
        """Fetch one asset, naming it from the URL rather than the header."""
        response = self._get(url, None)
        return media_type_from_url(url), response.content

    def close(self) -> None:
        """Release the underlying HTTP connection pool."""
        self._client.close()

    def _get(self, url: str, params: dict[str, str] | None) -> httpx.Response:
        """Issue one paced GET, retrying a rate limit on a fixed schedule."""
        for delay in _BACKOFF_SECONDS:
            response = self._attempt(url, params)
            if response.status_code != _TOO_MANY_REQUESTS:
                return _checked(response)
            self._sleep(delay)
        return _checked(self._attempt(url, params))

    def _attempt(self, url: str, params: dict[str, str] | None) -> httpx.Response:
        """Send one request, spacing it from the previous one."""
        now = time.monotonic()
        if self._last_request_at is not None:
            wait = _MIN_REQUEST_INTERVAL_SECONDS - (now - self._last_request_at)
            if wait > 0:
                self._sleep(wait)
        self._last_request_at = time.monotonic()
        try:
            return self._client.get(url, params=params, headers=_auth_headers())
        except httpx.HTTPError as exc:
            raise ExternalServiceError(f"Could not reach the datasets-server: {exc}") from exc


def _auth_headers() -> dict[str, str]:
    """Authenticate when a token is configured, raising the rate-limit ceiling."""
    token = os.environ.get("HF_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def _checked(response: httpx.Response) -> httpx.Response:
    """Return a successful response, or raise without parsing the body.

    A rate-limited response comes from the CDN as HTML, so reading it as JSON
    raises a decode error that names neither the status nor the cause.
    """
    if response.status_code == _TOO_MANY_REQUESTS:
        raise ExternalServiceError(
            "The HuggingFace datasets-server is rate limiting this import. "
            "Retry it later, or set HF_TOKEN to raise the limit."
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ExternalServiceError(
            f"The datasets-server answered {response.status_code} for {response.request.url}."
        ) from exc
    return response


def media_type_from_url(url: str) -> str:
    """Return the media type a URL's file suffix names."""
    suffix = Path(urlparse(url).path).suffix.lower()
    return _URL_MEDIA_TYPES.get(suffix, _UNKNOWN_MEDIA_TYPE)


def load_huggingface_triple(
    reader: RowsReader,
    *,
    name: str,
    description: str | None = None,
    write_media: MediaWriter,
    query_language: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> DatasetTriple:
    """Read a dataset's corpus, queries, and qrels into a `DatasetTriple`.

    `query_language` keeps only the queries whose `language` column matches,
    and drops the qrels whose query no longer resolves — a multilingual
    benchmark repeats one question set per language, so without the filter a
    run evaluates the same questions several times over.
    """
    corpus = _load_corpus(reader, write_media, on_progress)
    queries = _load_queries(reader, query_language)
    kept = {query.external_query_id for query in queries}
    qrels = [qrel for qrel in _load_qrels(reader) if qrel.query_external_id in kept]
    return DatasetTriple(
        name=name,
        description=description,
        corpus=corpus,
        queries=queries,
        qrels=qrels,
    )


def _load_corpus(
    reader: RowsReader,
    write_media: MediaWriter,
    on_progress: ProgressCallback | None,
) -> list[CorpusDoc]:
    """Read every corpus row, storing each page's images as it goes."""
    docs: list[CorpusDoc] = []
    for page in _pages(reader, "corpus"):
        docs.extend(_corpus_doc(envelope.row, reader, write_media) for envelope in page.rows)
        if on_progress is not None:
            on_progress(len(docs), page.num_rows_total)
    return docs


def _corpus_doc(
    row: Mapping[str, object], reader: RowsReader, write_media: MediaWriter
) -> CorpusDoc:
    """Build one corpus document, fetching and storing its image if it has one."""
    external_id = _identifier(row, _CORPUS_ID)
    media: MediaAsset | None = None
    image = _image_cell(row)
    if image is not None:
        content_type, data = reader.media(image.src)
        media = write_media("docs", external_id, content_type=content_type, data=data)
    return CorpusDoc(
        external_doc_id=external_id,
        text=_optional_text(row.get(_TEXT)),
        metadata=_scalar_cells(row, skip={_CORPUS_ID, _IMAGE, _TEXT}),
        media=media,
    )


def _load_queries(reader: RowsReader, query_language: str | None) -> list[QueryRecord]:
    """Read every query row, keeping only the requested language when set."""
    records: list[QueryRecord] = []
    for page in _pages(reader, "queries"):
        for envelope in page.rows:
            row = envelope.row
            if query_language is not None and row.get(_LANGUAGE) != query_language:
                continue
            records.append(
                QueryRecord(
                    external_query_id=_identifier(row, _QUERY_ID),
                    text=str(row.get(_QUERY_TEXT, "")),
                )
            )
    return records


def _load_qrels(reader: RowsReader) -> list[Qrel]:
    """Read every relevance judgment."""
    judgments: list[Qrel] = []
    for page in _pages(reader, "qrels"):
        for envelope in page.rows:
            row = envelope.row
            judgments.append(
                Qrel(
                    query_external_id=_identifier(row, _QUERY_ID),
                    doc_external_id=_identifier(row, _CORPUS_ID),
                    relevance=_relevance(row.get(_SCORE)),
                )
            )
    return judgments


def _pages(reader: RowsReader, config: str) -> Iterator[RowsPage]:
    """Page one config to its end.

    The offset advances by the rows actually returned rather than by the page
    size, because reading past the end truncates the page instead of failing.
    A page shorter than the one asked for is that truncation, so it ends the
    split: `num_rows_total` is a reported count that can be stale, and trusting
    it alone keeps asking for rows past the last one there is.
    """
    offset = 0
    while True:
        page = reader.rows(config, offset, MAX_PAGE_ROWS)
        if not page.rows:
            return
        yield page
        offset += len(page.rows)
        if len(page.rows) < MAX_PAGE_ROWS or offset >= page.num_rows_total:
            return


def _image_cell(row: Mapping[str, object]) -> ImageCell | None:
    """Return the row's image reference, or None when it carries no image."""
    value = row.get(_IMAGE)
    if value is None:
        return None
    try:
        return ImageCell.model_validate(value)
    except ValidationError as exc:
        raise InvalidInputError(f"Dataset image column is not a URL reference: {exc}") from exc


def _identifier(row: Mapping[str, object], column: str) -> str:
    """Read one id column as a string.

    BEIR-shaped datasets on the hub type their ids as integers, and an id is a
    key rather than a number everywhere downstream.
    """
    value = row.get(column)
    if isinstance(value, str) and value:
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    raise InvalidInputError(f"Dataset row is missing a usable '{column}' value.")


def _relevance(value: object) -> int:
    """Read a qrels score, defaulting an absent one to a positive judgment."""
    if value is None:
        return 1
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    raise InvalidInputError(f"qrels score must be an integer, got {value!r}.")


def _optional_text(value: object) -> str | None:
    """Return a non-empty text cell, or None."""
    return value if isinstance(value, str) and value else None


def _scalar_cells(row: Mapping[str, object], *, skip: set[str]) -> dict[str, object]:
    """Keep a row's remaining scalar columns as the record's metadata."""
    return {
        key: value
        for key, value in row.items()
        if key not in skip and isinstance(value, str | int | float | bool)
    }
