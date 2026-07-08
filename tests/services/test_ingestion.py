"""Behavior of ``IngestionService`` (happy path, pipeline resolution, failures).

Merged from `test_ingestion_service_coverage.py`: pure-function edge tests
(`resolve_ingestion_pipeline`, `_extract_indexing_payload`) moved here
unchanged; the private `_record_failure` tests were dropped because they
duplicated coverage that already exists at two other layers -- run-status
transitions are asserted directly on `PipelineTraceRecorder` in
`tests/pipelines/test_pipeline_trace.py`, and the document-status/event side
effects `_record_failure` owns are exercised through the public
`ingest_upload` failure path below (which now also asserts the run status).
"""

from __future__ import annotations

import io

import pytest
from pinecone.exceptions import PineconeException
from sqlmodel import Session, select

from app.db import models
from app.db.models import DocumentStatus
from app.pipelines.defaults import build_default_retrieval_pipeline
from app.schemas.openrouter import OpenRouterEmbeddingsResponse
from app.services import ingestion as ingestion_module
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.ingestion import IngestionService
from app.services.pipeline_resolution import resolve_ingestion_pipeline
from app.services.pipelines import PipelineService
from app.vectorstores.pgvector import PgvectorStore


class _StubOpenRouterClient:
    """Stand-in for `OpenRouterClient` at the client boundary."""

    def embed(
        self,
        texts: object,
        model: str | None = None,
        extra_headers: dict[str, str] | None = None,
        dimensions: int | None = None,
    ) -> OpenRouterEmbeddingsResponse:
        texts = list(texts)  # type: ignore[arg-type]
        return OpenRouterEmbeddingsResponse.model_validate(
            {
                "data": [{"embedding": [0.1, 0.2, 0.3]} for _ in texts],
                "usage": {"prompt_tokens": len(texts) * 3, "total_tokens": len(texts) * 3},
            }
        )


    def __init__(self) -> None:
        self.upserted: list[dict[str, object]] = []

    def upsert(self, vectors: object, namespace: str | None = None) -> None:
        self.upserted.append({"vectors": vectors, "namespace": namespace})



def _create_user(session: Session) -> models.User:
    user = models.User(
        email="unit@example.com",
        full_name="Unit Tester",
        hashed_password="hashed",
        openrouter_api_key="openrouter-key",
        pinecone_api_key="pinecone-key",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User, **overrides: object) -> models.Collection:
    defaults: dict[str, object] = {
        "user_id": user.id,
        "name": "Collection",
        "description": "",
        "extra_metadata": {},
    }
    defaults.update(overrides)
    collection = models.Collection(**defaults)  # type: ignore[arg-type]
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_ingest_upload_happy_path_persists_chunks_and_marks_ready(
    monkeypatch, pgvector_session: Session
) -> None:
    """A successful upload embeds, indexes into the default pgvector backend,
    and persists chunks; the document ends `READY` with a chunk count matching
    what's actually in the DB, and the `IngestionResponse` reflects the same
    numbers."""
    session = pgvector_session
    monkeypatch.setattr(
        ingestion_module, "get_openrouter_client", lambda *_a, **_k: _StubOpenRouterClient()
    )

    user = _create_user(session)
    collection = _create_collection(session, user)
    service = IngestionService(session)

    content = b"Paris is the capital of France. It is known for the Eiffel Tower."
    response = service.ingest_upload(
        user=user,
        collection=collection,
        filename="doc.txt",
        content_type="text/plain",
        stream=io.BytesIO(content),
    )

    document = session.get(models.Document, response.document.id)
    assert document is not None
    assert document.status == DocumentStatus.READY
    assert document.num_chunks == response.chunk_count
    assert response.chunk_count > 0
    assert response.embedding_model
    assert response.usage == {"prompt_tokens": response.chunk_count * 3, "total_tokens": response.chunk_count * 3}

    chunk_records = session.exec(
        select(models.DocumentChunkRecord).where(
            models.DocumentChunkRecord.document_id == document.id
        )
    ).all()
    assert len(chunk_records) == response.chunk_count
    assert all(record.embedding == [0.1, 0.2, 0.3] for record in chunk_records)
    assert all(record.text for record in chunk_records)

    # The indexer actually upserted the chunks into the pgvector index.
    store = PgvectorStore(session)
    assert store.describe_index("ragworks").dimension == 3
    indexed = store.query(
        "ragworks",
        f"col-{collection.id}",
        embedding=[0.1, 0.2, 0.3],
        top_k=50,
    )
    assert len(indexed.matches) == response.chunk_count

    event = session.exec(select(models.IngestionEvent)).first()
    assert event is not None
    assert event.event_type == "ingestion_complete"
    assert event.status == "success"
    assert event.details["chunks"] == response.chunk_count


def test_ingest_upload_marks_document_failed_on_exception(monkeypatch, session, tmp_path) -> None:
    class _StubStorage:
        def __init__(self) -> None:
            self.base_path = tmp_path

        def save_stream(self, _stream: object, _relative_path: str):
            return tmp_path / "upload.txt"

    class _FailingExecutor:
        def __init__(self, _registry: object) -> None:
            self.registry = _registry

        def execute(self, _definition: object, _context: object) -> None:
            raise RuntimeError("parse failed")

    monkeypatch.setattr(ingestion_module, "FileStorage", _StubStorage)
    monkeypatch.setattr(ingestion_module, "get_openrouter_client", lambda *_args, **_kwargs: object())
    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _FailingExecutor)

    user = _create_user(session)
    collection = _create_collection(session, user)
    service = IngestionService(session)

    with pytest.raises(RuntimeError, match="parse failed"):
        service.ingest_upload(
            user=user,
            collection=collection,
            filename="doc.txt",
            content_type="text/plain",
            stream=io.BytesIO(b"content"),
        )

    document = session.exec(select(models.Document)).first()
    assert document is not None
    assert document.status == DocumentStatus.FAILED

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED
    assert run.error_message == "parse failed"

    event = session.exec(select(models.IngestionEvent)).first()
    assert event is not None
    assert event.event_type == "ingestion_failed"
    assert event.status == "error"
    assert "parse failed" in event.details["error"]


def test_ingest_upload_wraps_pinecone_outage_as_external_service_error(
    monkeypatch, session, tmp_path
) -> None:
    """A Pinecone outage mid-upload must surface as a 502-mapped
    `ExternalServiceError`, not the raw SDK exception -- while still marking
    the document and run FAILED, same as any other pipeline failure."""

    class _StubStorage:
        def __init__(self) -> None:
            self.base_path = tmp_path

        def save_stream(self, _stream: object, _relative_path: str):
            return tmp_path / "upload.txt"

    class _FailingExecutor:
        def __init__(self, _registry: object) -> None:
            self.registry = _registry

        def execute(self, _definition: object, _context: object) -> None:
            raise PineconeException("Pinecone is unavailable")

    monkeypatch.setattr(ingestion_module, "FileStorage", _StubStorage)
    monkeypatch.setattr(ingestion_module, "get_openrouter_client", lambda *_args, **_kwargs: object())
    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _FailingExecutor)

    user = _create_user(session)
    collection = _create_collection(session, user)
    service = IngestionService(session)

    with pytest.raises(ExternalServiceError, match="Pinecone is unavailable"):
        service.ingest_upload(
            user=user,
            collection=collection,
            filename="doc.txt",
            content_type="text/plain",
            stream=io.BytesIO(b"content"),
        )

    document = session.exec(select(models.Document)).first()
    assert document is not None
    assert document.status == DocumentStatus.FAILED

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED


def test_resolve_ingestion_pipeline_rejects_missing(session: Session) -> None:
    """`resolve_ingestion_pipeline` (app/services/pipeline_resolution.py) rejects
    a collection pointing at a retrieval pipeline instead of an ingestion one.

    This used to be `IngestionService._resolve_ingestion_pipeline`; the check
    moved to the shared resolver both `IngestionService` and `RetrievalService`
    call through.
    """
    user = _create_user(session)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Retrieval",
        kind=models.PipelineKind.RETRIEVAL,
        definition=build_default_retrieval_pipeline(),
    )
    session.commit()
    collection = _create_collection(session, user, ingestion_pipeline_id=pipeline.id)

    with pytest.raises(InvalidInputError, match="Ingestion pipeline could not be resolved"):
        resolve_ingestion_pipeline(session, user, collection)


def test_extract_indexing_payload_raises_for_missing_result() -> None:
    """Pure-function edge case: a malformed pipeline result payload raises a
    typed domain error rather than a raw `KeyError`/`ValidationError`. Kept as
    a direct test of the static method -- it's pure data-in/data-out logic,
    not wiring, and the malformed-payload shape isn't reachable through the
    public `ingest_upload` path with any real pipeline definition."""
    with pytest.raises(InvalidInputError, match="ingestion result payload"):
        IngestionService._extract_indexing_payload({"node": {"data": {}}})
