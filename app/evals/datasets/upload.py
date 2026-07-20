"""Parse a user-uploaded dataset in the standard BEIR format.

BEIR ships three files: `corpus.jsonl` (`_id`, `title`, `text`), `queries.jsonl`
(`_id`, `text`), and a `qrels` TSV (`query-id`, `corpus-id`, `score`, with an
optional header row). This parser turns those into the same `DatasetTriple` a
curated benchmark produces, so an uploaded dataset and a builtin benchmark are
interchangeable to the run engine. Malformed input is a clear `InvalidInputError`
rather than a silent drop that would corrupt the ground truth.
"""

from __future__ import annotations

import json

from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
from app.services.errors import InvalidInputError

_QRELS_HEADER = {"query-id", "corpus-id", "score"}


def parse_beir_upload(
    *,
    name: str,
    corpus: str,
    queries: str,
    qrels: str,
    description: str | None = None,
) -> DatasetTriple:
    """Parse BEIR-format corpus/queries/qrels text into a `DatasetTriple`."""
    corpus_docs = _parse_corpus(corpus)
    query_records = _parse_queries(queries)
    if not corpus_docs:
        raise InvalidInputError("Uploaded corpus is empty.")
    if not query_records:
        raise InvalidInputError("Uploaded queries file is empty.")
    return DatasetTriple(
        name=name,
        description=description,
        corpus=corpus_docs,
        queries=query_records,
        qrels=_parse_qrels(qrels),
    )


def _parse_corpus(corpus: str) -> list[CorpusDoc]:
    """Parse the corpus JSONL into corpus documents."""
    docs: list[CorpusDoc] = []
    for record in _iter_jsonl(corpus, "corpus"):
        external_id = record.get("_id")
        if not isinstance(external_id, str) or not external_id:
            raise InvalidInputError("Every corpus row needs a non-empty '_id'.")
        title = record.get("title")
        docs.append(
            CorpusDoc(
                external_doc_id=external_id,
                text=str(record.get("text", "")),
                title=title if isinstance(title, str) and title else None,
            )
        )
    return docs


def _parse_queries(queries: str) -> list[QueryRecord]:
    """Parse the queries JSONL into query records."""
    records: list[QueryRecord] = []
    for record in _iter_jsonl(queries, "queries"):
        external_id = record.get("_id")
        if not isinstance(external_id, str) or not external_id:
            raise InvalidInputError("Every query row needs a non-empty '_id'.")
        records.append(
            QueryRecord(external_query_id=external_id, text=str(record.get("text", "")))
        )
    return records


def _parse_qrels(qrels: str) -> list[Qrel]:
    """Parse the qrels TSV (optional header) into relevance judgments."""
    judgments: list[Qrel] = []
    for line in qrels.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        columns = stripped.split("\t")
        if len(columns) < 3:
            raise InvalidInputError("Every qrels row needs query-id, corpus-id, and score.")
        if set(column.strip() for column in columns[:3]) == _QRELS_HEADER:
            continue
        judgments.append(_parse_qrel_row(columns))
    return judgments


def _parse_qrel_row(columns: list[str]) -> Qrel:
    """Parse one qrels row, tolerating a non-integer score by rejecting it."""
    try:
        relevance = int(columns[2])
    except ValueError as exc:
        raise InvalidInputError(f"qrels score must be an integer, got {columns[2]!r}.") from exc
    return Qrel(
        query_external_id=columns[0].strip(),
        doc_external_id=columns[1].strip(),
        relevance=relevance,
    )


def _iter_jsonl(payload: str, label: str) -> list[dict[str, object]]:
    """Parse non-blank JSONL lines into dicts, rejecting malformed rows."""
    rows: list[dict[str, object]] = []
    for line in payload.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise InvalidInputError(f"Malformed JSON in {label} file: {exc}") from exc
        if not isinstance(parsed, dict):
            raise InvalidInputError(f"Each {label} row must be a JSON object.")
        rows.append(parsed)
    return rows
