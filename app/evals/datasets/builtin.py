"""Curated benchmark registry and the BEIR zip loader.

Built-in benchmarks come from one of two sources: a BEIR archive (the standard
`corpus.jsonl` / `queries.jsonl` / `qrels/*.tsv` layout), or the HuggingFace
datasets-server, which serves page-image benchmarks already in BEIR triple
form. Both parse into the same `DatasetTriple` an uploaded dataset produces —
no heavy dataset dependency, and offline deployments simply cannot fetch new
ones until they have connectivity. The registry is intentionally limited to
datasets whose import and first run finish in minutes rather than hours.
"""

from __future__ import annotations

import io
import zipfile
from collections.abc import Callable
from dataclasses import dataclass

from app.evals.datasets.base import DatasetTriple
from app.evals.datasets.hf_datasets_server import (
    HuggingFaceRowsClient,
    MediaWriter,
    ProgressCallback,
    RowsReader,
    load_huggingface_triple,
)
from app.evals.datasets.upload import parse_beir_upload
from app.schemas.enums import EvalModality
from app.services.errors import ExternalServiceError, InvalidInputError, NotFoundError

_BEIR_HOST = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets"
_TEXT = (EvalModality.TEXT.value,)
_IMAGE = (EvalModality.IMAGE.value,)


@dataclass(frozen=True)
class BeirZipSource:
    """A BEIR archive downloaded as one zip."""

    url: str


@dataclass(frozen=True)
class HuggingFaceSource:
    """A BEIR-shaped dataset read page by page from the datasets-server.

    `query_language` keeps only the queries in one language. A multilingual
    benchmark repeats one question set per language, so importing all of them
    makes a run evaluate the same questions several times over.
    """

    repo_id: str
    split: str = "test"
    query_language: str | None = None


#: Where a benchmark's data comes from. `download_builtin` dispatches on it.
BuiltinSource = BeirZipSource | HuggingFaceSource


@dataclass(frozen=True)
class BuiltinEntry:
    """One curated benchmark in the registry, before it is imported.

    `domain` and `measures` are the user-facing framing: the corpus/query
    domain, and what a good or bad score on this benchmark actually tells you
    about a pipeline. `license_name` and `approx_download_mb` are shown before
    the import starts — a non-commercial licence or a 300 MiB download is a
    decision the user makes, not one made for them.
    """

    key: str
    name: str
    description: str
    domain: str
    measures: str
    source: BuiltinSource
    num_queries: int
    num_corpus_docs: int
    license_name: str
    approx_download_mb: int
    modalities: tuple[str, ...] = _TEXT


_ENTRIES: tuple[BuiltinEntry, ...] = (
    BuiltinEntry(
        key="scifact",
        name="SciFact",
        description="Scientific claim verification against a corpus of abstracts.",
        domain="Biomedical literature",
        measures=(
            "Claim-style queries against dense scientific abstracts. Scores track"
            " precise semantic matching in technical prose; keyword overlap alone"
            " does poorly here."
        ),
        source=BeirZipSource(url=f"{_BEIR_HOST}/scifact.zip"),
        num_queries=300,
        num_corpus_docs=5183,
        license_name="CC BY-SA 4.0",
        approx_download_mb=3,
    ),
    BuiltinEntry(
        key="nfcorpus",
        name="NFCorpus",
        description="Medical information-retrieval queries over PubMed documents.",
        domain="Medical / nutrition",
        measures=(
            "Plain-language health questions against clinical PubMed text. The"
            " lay-to-clinical vocabulary gap is the difficulty: lexical-only"
            " retrieval degrades, so it separates embedding quality from term"
            " matching."
        ),
        source=BeirZipSource(url=f"{_BEIR_HOST}/nfcorpus.zip"),
        num_queries=323,
        num_corpus_docs=3633,
        license_name="CC BY-SA 4.0",
        approx_download_mb=2,
    ),
    BuiltinEntry(
        key="arguana",
        name="ArguAna",
        description="Counter-argument retrieval for debate-style claims.",
        domain="Argumentation / debate",
        measures=(
            "Finds the best counterargument to a full argument passage. Query and"
            " document are both long, so it stresses long-text embeddings and"
            " chunking choices more than short-query benchmarks."
        ),
        source=BeirZipSource(url=f"{_BEIR_HOST}/arguana.zip"),
        num_queries=1406,
        num_corpus_docs=8674,
        license_name="CC BY-SA 4.0",
        approx_download_mb=4,
    ),
    BuiltinEntry(
        key="fiqa",
        name="FiQA-2018",
        description="Financial-domain opinion question answering over forum posts.",
        domain="Finance",
        measures=(
            "Opinion questions over informal, jargon-heavy forum and StackExchange"
            " posts. Scores reflect robustness to noisy user-generated text and"
            " domain slang."
        ),
        source=BeirZipSource(url=f"{_BEIR_HOST}/fiqa.zip"),
        num_queries=648,
        num_corpus_docs=57638,
        license_name="CC BY-SA 4.0",
        approx_download_mb=17,
    ),
    BuiltinEntry(
        key="vidore-economics-v2",
        name="ViDoRe v2 — Economics reports",
        description="Page images from economics reports, retrieved by written question.",
        domain="Economics reports (page images)",
        measures=(
            "Retrieval over rendered report pages: charts, tables, and layout"
            " carry the answer, and no text is supplied. Around 15 pages are"
            " relevant per query, so rank-aware scores measure ordering rather"
            " than a single hit."
        ),
        source=HuggingFaceSource(repo_id="vidore/economics_reports_v2", query_language="english"),
        num_queries=58,
        num_corpus_docs=452,
        license_name="CC BY 3.0",
        approx_download_mb=53,
        modalities=_IMAGE,
    ),
    BuiltinEntry(
        key="vidore-biomedical-v2",
        name="ViDoRe v2 — Biomedical lectures",
        description="Page images from biomedical lecture slides, retrieved by written question.",
        domain="Biomedical lecture slides (page images)",
        measures=(
            "Slide pages mixing diagrams, dense annotation, and technical"
            " vocabulary. Scores separate an embedding model that reads a"
            " figure from one that only reads the words rendered beside it."
        ),
        source=HuggingFaceSource(repo_id="vidore/biomedical_lectures_v2", query_language="english"),
        num_queries=160,
        num_corpus_docs=1016,
        license_name="CC BY-NC-SA 4.0",
        approx_download_mb=74,
        modalities=_IMAGE,
    ),
    BuiltinEntry(
        key="real-mm-rag-finslides",
        name="REAL-MM-RAG — FinSlides",
        description="Page images from financial earnings presentations, one relevant page per query.",
        domain="Financial presentations (page images)",
        measures=(
            "Numeric questions against quarterly earnings slides, with exactly"
            " one correct page each. Precision at the top rank is the whole"
            " signal, and near-duplicate quarters make it a hard one."
        ),
        source=HuggingFaceSource(repo_id="ibm-research/REAL-MM-RAG_FinSlides_BEIR"),
        num_queries=1052,
        num_corpus_docs=2280,
        license_name="CDLA-Permissive 2.0",
        approx_download_mb=312,
        modalities=_IMAGE,
    ),
)

_REGISTRY: dict[str, BuiltinEntry] = {entry.key: entry for entry in _ENTRIES}


def list_builtin() -> list[BuiltinEntry]:
    """Return every curated benchmark in the registry."""
    return list(_ENTRIES)


def get_builtin(key: str) -> BuiltinEntry:
    """Return a curated benchmark by key, or raise NotFoundError."""
    entry = _REGISTRY.get(key)
    if entry is None:
        raise NotFoundError(f"Unknown benchmark dataset: {key}")
    return entry


def download_builtin(
    entry: BuiltinEntry,
    *,
    write_media: MediaWriter,
    fetch: Callable[[str], bytes] | None = None,
    reader: RowsReader | None = None,
    on_progress: ProgressCallback | None = None,
) -> DatasetTriple:
    """Fetch a curated benchmark from its own source and parse it into a triple.

    `write_media` stores whatever bytes the source carries; a text benchmark
    never calls it. `fetch` and `reader` are the two sources' transports,
    injected so the parse path can be exercised without the network.
    """
    match entry.source:
        case BeirZipSource(url=url):
            data = (fetch or _http_fetch)(url)
            return load_beir_zip(data, name=entry.name, description=entry.description)
        case HuggingFaceSource(repo_id=repo_id, split=split, query_language=query_language):
            rows = reader or HuggingFaceRowsClient(repo_id, split)
            return load_huggingface_triple(
                rows,
                name=entry.name,
                description=entry.description,
                write_media=write_media,
                query_language=query_language,
                on_progress=on_progress,
            )


def load_beir_zip(
    data: bytes,
    *,
    name: str,
    description: str | None = None,
) -> DatasetTriple:
    """Extract a BEIR-shaped zip and parse it into a `DatasetTriple`.

    Members are matched by filename suffix, so the top-level folder name inside
    the archive does not matter. The `test` qrels split is preferred when present.
    """
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise InvalidInputError(f"Downloaded benchmark is not a valid zip: {exc}") from exc

    names = archive.namelist()
    corpus_member = _find_member(names, "corpus.jsonl")
    queries_member = _find_member(names, "queries.jsonl")
    qrels_member = _find_qrels_member(names)
    if not corpus_member or not queries_member or not qrels_member:
        raise InvalidInputError("Benchmark archive is missing a corpus, queries, or qrels file.")

    return parse_beir_upload(
        name=name,
        description=description,
        corpus=archive.read(corpus_member).decode("utf-8"),
        queries=archive.read(queries_member).decode("utf-8"),
        qrels=archive.read(qrels_member).decode("utf-8"),
        strict=False,
    )


def _find_member(names: list[str], suffix: str) -> str | None:
    """Return the first archive member whose path ends with the suffix."""
    for member in names:
        if member.endswith(suffix):
            return member
    return None


def _find_qrels_member(names: list[str]) -> str | None:
    """Return the qrels split, preferring test.tsv, then any qrels TSV."""
    preferred = _find_member(names, "qrels/test.tsv")
    if preferred:
        return preferred
    for member in names:
        if "qrels/" in member and member.endswith(".tsv"):
            return member
    return None


def _http_fetch(url: str) -> bytes:
    """Download a benchmark archive over HTTP with an explicit timeout."""
    import httpx  # local import: keeps this module import-time side-effect free

    try:
        response = httpx.get(url, timeout=120.0, follow_redirects=True)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise ExternalServiceError(f"Could not download benchmark dataset: {exc}") from exc
    return response.content
