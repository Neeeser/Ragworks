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
    judgments = _parse_qrels(qrels)
    _check_qrel_ids(
        judgments,
        doc_ids={doc.external_doc_id for doc in corpus_docs},
        query_ids={record.external_query_id for record in query_records},
    )
    return DatasetTriple(
        name=name,
        description=description,
        corpus=corpus_docs,
        queries=query_records,
        qrels=judgments,
    )


def _check_qrel_ids(
    judgments: list[Qrel], *, doc_ids: set[str], query_ids: set[str]
) -> None:
    """Reject qrels naming ids absent from the corpus or queries files.

    Ground truth pointing at a document or query the dataset does not contain
    can never be scored, and surfaces at run time as a misleading funnel
    finding rather than as the upload error it is. A query carrying no qrels
    row at all stays legal — that is the BEIR encoding of "no gold document".
    """
    for judgment in judgments:
        if judgment.doc_external_id not in doc_ids:
            raise InvalidInputError(
                f"qrels corpus-id {judgment.doc_external_id!r} is not in the corpus file."
            )
        if judgment.query_external_id not in query_ids:
            raise InvalidInputError(
                f"qrels query-id {judgment.query_external_id!r} is not in the queries file."
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
                text=_require_text(record.get("text"), label="corpus", row_id=external_id),
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
            QueryRecord(
                external_query_id=external_id,
                text=_require_text(record.get("text"), label="query", row_id=external_id),
            )
        )
    return records


def _require_text(value: object, *, label: str, row_id: str) -> str:
    """Return a non-empty string `text` field, rejecting anything else.

    A missing or blank `text` would otherwise ingest and index an empty
    document, which no retrieval can ever return and nothing later reports.
    """
    if not isinstance(value, str) or not value.strip():
        raise InvalidInputError(f"Every {label} row needs a non-empty 'text' (row {row_id!r}).")
    return value


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
        if {column.strip() for column in columns[:3]} == _QRELS_HEADER:
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
