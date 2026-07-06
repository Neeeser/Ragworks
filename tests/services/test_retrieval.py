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
from app.schemas.openrouter import OpenRouterEmbeddingsResponse
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.pipelines import PipelineService
from app.services.retrieval import RetrievalService


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


class _StubPineconeMatch:
    """Stand-in for the Pinecone SDK's `ScoredVector`."""

    def __init__(self, match_id: str, score: float, metadata: dict[str, object]) -> None:
        self.id = match_id
        self.score = score
        self.metadata = metadata


class _StubPineconeQueryResult:
    def __init__(self, matches: list[_StubPineconeMatch]) -> None:
        self.matches = matches


class _StubPineconeIndex:
    def __init__(self, matches: list[_StubPineconeMatch]) -> None:
        self._matches = matches

    def query(self, **_kwargs: object) -> _StubPineconeQueryResult:
        return _StubPineconeQueryResult(self._matches)


class _StubPineconeClient:
    """Stand-in for the Pinecone SDK client at the client boundary."""

    def __init__(self, matches: list[_StubPineconeMatch]) -> None:
        self._index = _StubPineconeIndex(matches)

    def Index(self, _name: str) -> _StubPineconeIndex:
        return self._index


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
    monkeypatch, session: Session
) -> None:
    """A successful query maps Pinecone matches onto `RetrievedChunk`s and
    records a `QueryEvent` carrying the same latency/usage/pipeline-run data
    the response reports."""
    monkeypatch.setattr(
        "app.services.retrieval.get_openrouter_client", lambda *_a, **_k: _StubOpenRouterClient()
    )
    matches = [
        _StubPineconeMatch(
            "chunk-1",
            0.87,
            {"text": "Paris is the capital of France.", "document_id": "doc-1", "order": 0},
        )
    ]
    monkeypatch.setattr(
        "app.services.retrieval.get_pinecone_client",
        lambda **_k: _StubPineconeClient(matches),
    )

    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    response = service.query_collection(user, collection, query="capital of France", top_k=3)

    assert response.query == "capital of France"
    assert response.top_k == 3
    assert len(response.chunks) == 1
    chunk = response.chunks[0]
    assert chunk.chunk_id == "chunk-1"
    assert chunk.document_id == "doc-1"
    assert chunk.score == pytest.approx(0.87)
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
    monkeypatch.setattr("app.services.retrieval.get_pinecone_client", lambda *_args, **_kwargs: object())

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
    monkeypatch.setattr("app.services.retrieval.get_pinecone_client", lambda *_args, **_kwargs: object())

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
    monkeypatch.setattr("app.services.retrieval.get_pinecone_client", lambda *_args, **_kwargs: object())

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
