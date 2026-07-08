"""Behavior of ``RetrievalService`` (happy path, pipeline resolution, failures).

Merged from `test_retrieval_service_coverage.py`. `test_usage_tokens_prefers_known_keys`
was dropped along with the `_usage_tokens` method it tested: `payload.usage` is a typed
`TokenUsage` (two known fields), so there's no longer a dict of arbitrary keys to
normalize -- the happy-path test below asserts the replacement (`_context_tokens`)
indirectly through the persisted `QueryEvent.context_tokens`.
"""

from __future__ import annotations

import pytest
from pinecone.exceptions import PineconeException
from sqlmodel import Session, select

from app.db import models
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.openrouter import OpenRouterEmbeddingsResponse
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.pipelines import PipelineService
from app.services.retrieval import RetrievalService
from app.vectorstores.base import IndexSpec
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
                "usage": {"prompt_tokens": 5, "total_tokens": 5},
            }
        )



def _create_user(session: Session) -> models.User:
    user = models.User(
        email="retrieval@example.com",
        full_name="Retrieval User",
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


def test_query_collection_happy_path_maps_chunks_and_records_event(
    monkeypatch, pgvector_session: Session
) -> None:
    """A successful query maps vector-store matches onto `RetrievedChunk`s and
    records a `QueryEvent` carrying the same latency/usage/pipeline-run data
    the response reports."""
    session = pgvector_session
    monkeypatch.setattr(
        "app.services.retrieval.get_openrouter_client", lambda *_a, **_k: _StubOpenRouterClient()
    )

    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    store = PgvectorStore(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    store.upsert(
        "ragworks",
        f"col-{collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id="chunk-1",
                text="Paris is the capital of France.",
                order=0,
                metadata=DocumentMetadata(data={}),
                embedding=[0.1, 0.2, 0.3],
            )
        ],
    )

    response = service.query_collection(user, collection, query="capital of France", top_k=3)

    assert response.query == "capital of France"
    assert response.top_k == 3
    assert len(response.chunks) == 1
    chunk = response.chunks[0]
    assert chunk.chunk_id == "chunk-1"
    assert chunk.document_id == "doc-1"
    assert chunk.score == pytest.approx(1.0, abs=1e-6)  # identical vectors: cosine similarity 1
    assert chunk.text == "Paris is the capital of France."
    assert response.usage == {"prompt_tokens": 5, "total_tokens": 5}
    assert response.query_event_id is not None
    assert response.pipeline_run_id is not None

    event = session.get(models.QueryEvent, response.query_event_id)
    assert event is not None
    assert event.query_text == "capital of France"
    assert event.top_k == 3
    assert event.latency_ms >= 0
    assert event.context_tokens == 5
    assert event.pipeline_run_id == response.pipeline_run_id
    assert event.response_payload["match_count"] == 1


def test_query_collection_rejects_missing_pipeline(session: Session) -> None:
    user = _create_user(session)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Ingestion",
        kind=models.PipelineKind.INGESTION,
        definition=build_default_ingestion_pipeline(),
    )
    session.commit()
    collection = _create_collection(session, user, retrieval_pipeline_id=pipeline.id)
    service = RetrievalService(session)

    with pytest.raises(InvalidInputError, match="Retrieval pipeline could not be resolved"):
        service.query_collection(user, collection, query="hello")


def test_query_collection_marks_run_failed_on_exception(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    collection.retrieval_pipeline_id = defaults.retrieval.id
    session.add(collection)
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, _context):
            raise RuntimeError("boom")

    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.retrieval.get_openrouter_client", lambda *_args, **_kwargs: object())

    with pytest.raises(RuntimeError, match="boom"):
        service.query_collection(user, collection, query="hello")

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED
    assert run.error_message == "boom"


def test_query_collection_wraps_pinecone_outage_as_external_service_error(
    monkeypatch, session: Session
) -> None:
    """A Pinecone outage mid-query must surface as a 502-mapped
    `ExternalServiceError`, not the raw SDK exception (which the route has no
    handler for and would 500 on) -- while still marking the run FAILED."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    collection.retrieval_pipeline_id = defaults.retrieval.id
    session.add(collection)
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, _context):
            raise PineconeException("Pinecone is unavailable")

    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.retrieval.get_openrouter_client", lambda *_args, **_kwargs: object())

    with pytest.raises(ExternalServiceError, match="Pinecone is unavailable"):
        service.query_collection(user, collection, query="hello")

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED


def test_query_collection_skips_failed_run_update(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    collection.retrieval_pipeline_id = defaults.retrieval.id
    session.add(collection)
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, context):
            context.trace._run.status = models.PipelineRunStatus.FAILED
            raise RuntimeError("boom")

    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.retrieval.get_openrouter_client", lambda *_args, **_kwargs: object())

    with pytest.raises(RuntimeError, match="boom"):
        service.query_collection(user, collection, query="hello")

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED


def test_extract_retrieval_payload_raises_for_missing_result() -> None:
    """Pure-function edge case, kept as a direct test for the same reason as
    `IngestionService._extract_indexing_payload`'s test (see test_ingestion.py):
    it's pure data-in/data-out validation, not wiring."""
    with pytest.raises(InvalidInputError, match="retrieval result payload"):
        RetrievalService._extract_retrieval_payload({"node": {"data": {}}})
