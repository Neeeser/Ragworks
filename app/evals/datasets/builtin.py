"""Curated benchmark registry and the BEIR zip loader.

Built-in benchmarks are fetched on demand as BEIR archives (the standard
`corpus.jsonl` / `queries.jsonl` / `qrels/*.tsv` layout) and parsed through the
same path as an uploaded dataset — no heavy dataset dependency, and offline
deployments simply cannot fetch new ones until they have connectivity. The
registry is intentionally limited to small datasets so a first run finishes in
minutes rather than hours.
"""

from __future__ import annotations

import io
import zipfile
from collections.abc import Callable
from dataclasses import dataclass

from app.evals.datasets.base import DatasetTriple
from app.evals.datasets.upload import parse_beir_upload
from app.services.errors import ExternalServiceError, InvalidInputError, NotFoundError

_BEIR_HOST = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets"


@dataclass(frozen=True)
class BuiltinEntry:
    """One curated benchmark in the registry, before it is imported.

    `domain` and `measures` are the user-facing framing: the corpus/query
    domain, and what a good or bad score on this benchmark actually tells you
    about a pipeline. Each entry is its own per-dataset BEIR archive — importing
    one downloads only that dataset's zip.
    """

    key: str
    name: str
    description: str
    domain: str
    measures: str
    url: str
    num_queries: int
    num_corpus_docs: int


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
        url=f"{_BEIR_HOST}/scifact.zip",
        num_queries=300,
        num_corpus_docs=5183,
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
        url=f"{_BEIR_HOST}/nfcorpus.zip",
        num_queries=323,
        num_corpus_docs=3633,
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
        url=f"{_BEIR_HOST}/arguana.zip",
        num_queries=1406,
        num_corpus_docs=8674,
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
        url=f"{_BEIR_HOST}/fiqa.zip",
        num_queries=648,
        num_corpus_docs=57638,
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
    fetch: Callable[[str], bytes] | None = None,
) -> DatasetTriple:
    """Fetch a curated benchmark's BEIR archive and parse it into a triple."""
    fetcher = fetch or _http_fetch
    data = fetcher(entry.url)
    return load_beir_zip(data, name=entry.name, description=entry.description)


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
        raise InvalidInputError(
            "Benchmark archive is missing a corpus, queries, or qrels file."
        )

    return parse_beir_upload(
        name=name,
        description=description,
        corpus=archive.read(corpus_member).decode("utf-8"),
        queries=archive.read(queries_member).decode("utf-8"),
        qrels=archive.read(qrels_member).decode("utf-8"),
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
