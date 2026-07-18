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
from app.services.errors import ExternalServiceError, InvalidInputError
from app.services.pipelines import PipelineService
from app.services.retrieval import RetrievalService
from app.vectorstores.base import IndexSpec
from app.vectorstores.pgvector import PgvectorStore
from tests.utils.providers import TEST_EMBED_CONNECTION_ID, install_default_pipelines


class _StubEmbedder:
    """Embedder stand-in: every text embeds to the same fixed vector."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 5, "total_tokens": 5}

    def embed_documents(self, chunks):
        return [[0.1, 0.2, 0.3] for _ in chunks]

    def embed_query(self, _query: str):
        return [0.1, 0.2, 0.3]


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return _StubEmbedder(model_name)



def _create_user(session: Session) -> models.User:
    user = models.User(
        email="retrieval@example.com",
        full_name="Retrieval User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
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
    monkeypatch.setattr("app.services.retrieval.ProviderResolver", _StubProviderResolver)

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
    # The hybrid default fuses branches by reciprocal rank: the sole dense
    # match at rank 1 scores 1/(60+1); raw cosine similarity is replaced.
    assert chunk.score == pytest.approx(1 / 61, abs=1e-9)
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
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
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
    monkeypatch.setattr("app.services.retrieval.ProviderResolver", _StubProviderResolver)

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
    monkeypatch.setattr("app.services.retrieval.ProviderResolver", _StubProviderResolver)

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
    monkeypatch.setattr("app.services.retrieval.ProviderResolver", _StubProviderResolver)

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


def _declare_pipeline_variables(
    session: Session,
    user: models.User,
    *,
    arguments: list[dict[str, object]],
    outputs: list[dict[str, str]] | None = None,
    retriever_top_k_expression: str | None = None,
) -> None:
    """Rewrite the user's default retrieval pipeline with declared input variables."""
    from app.pipelines.definition import PipelineDefinition
    from app.pipelines.variables import PipelineVariable, VariableSource

    pipeline = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.kind == models.PipelineKind.RETRIEVAL,
        )
    ).one()
    service = PipelineService(session)
    version = service.get_current_version(pipeline)
    definition = PipelineDefinition.model_validate(version.definition)
    definition.variables = [
        PipelineVariable.model_validate(
            {
                "source": VariableSource.INPUT,
                "value": argument.get("default"),
                **{
                    key: value
                    for key, value in argument.items()
                    if key not in ("default", "required")
                },
            }
        )
        for argument in arguments
    ]
    names = [str(argument["name"]) for argument in arguments]
    for node in definition.nodes:
        if node.type == "retrieval.input":
            node.config = {**node.config, "arguments": names}
        if outputs is not None and node.type == "retrieval.output":
            node.config = {**node.config, "outputs": outputs}
        if retriever_top_k_expression is not None and node.type == "retriever.vector":
            node.config = {**node.config, "top_k": {"$expr": retriever_top_k_expression}}
        if node.type == "limit.top_n" and "top_k" not in names:
            # The scaffold's Top-N references the top_k variable this helper
            # just replaced; unset it so the cut falls back to the requested
            # depth instead of a dangling expression.
            node.config = {key: value for key, value in node.config.items() if key != "top_n"}
        if (
            node.type in ("retriever.vector", "retriever.bm25")
            and "top_k" not in names
            and retriever_top_k_expression is None
        ):
            # Same for the scaffold retrievers' required depth: pin a literal
            # when the top_k variable is gone.
            node.config = {**node.config, "top_k": 5}
    service.update_pipeline(
        pipeline=pipeline, definition=definition, change_summary="Declare arguments."
    )
    session.commit()


def test_query_arguments_default_scaffold_declares_top_k(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    response = RetrievalService(session).query_arguments(user, collection)
    assert [argument.name for argument in response.arguments] == ["top_k"]


def test_query_arguments_empty_when_pipeline_declares_none(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    _declare_pipeline_variables(session, user, arguments=[])
    response = RetrievalService(session).query_arguments(user, collection)
    assert response.arguments == []


def test_query_arguments_lists_declared_arguments(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    _declare_pipeline_variables(
        session,
        user,
        arguments=[
            {
                "name": "top_k",
                "type": "integer",
                "default": 5,
                "minimum": 1,
                "maximum": 10,
                "expose_to_llm": True,
            },
            {
                "name": "mode",
                "type": "enum",
                "default": "fast",
                "choices": ["fast", "deep"],
            },
        ],
    )
    response = RetrievalService(session).query_arguments(user, collection)
    assert [argument.name for argument in response.arguments] == ["top_k", "mode"]
    top_k = response.arguments[0]
    assert top_k.type == "integer"
    assert top_k.default == 5
    assert top_k.maximum == 10
    assert top_k.expose_to_llm is True
    assert response.arguments[1].choices == ["fast", "deep"]


def test_query_collection_rejects_unknown_argument(monkeypatch, session: Session) -> None:
    monkeypatch.setattr("app.services.retrieval.ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    with pytest.raises(InvalidInputError, match="Unknown argument 'nope'"):
        RetrievalService(session).query_collection(
            user, collection, query="hello", arguments={"nope": 1}
        )
    # Rejected input never records a run.
    assert session.exec(select(models.PipelineRun)).first() is None


def test_query_collection_rejects_constraint_violation(
    monkeypatch, session: Session
) -> None:
    monkeypatch.setattr("app.services.retrieval.ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _declare_pipeline_variables(
        session,
        user,
        arguments=[
            {"name": "top_k", "type": "integer", "default": 5, "minimum": 1, "maximum": 10}
        ],
    )
    with pytest.raises(InvalidInputError, match="must be at most 10"):
        RetrievalService(session).query_collection(
            user, collection, query="hello", arguments={"top_k": 99}
        )


def test_query_collection_arguments_drive_over_retrieval_and_outputs(
    monkeypatch, pgvector_session: Session
) -> None:
    """Declared arguments flow into expressions (retriever top_k) and declared
    outputs come back on the response and the recorded QueryEvent."""
    session = pgvector_session
    monkeypatch.setattr("app.services.retrieval.ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _declare_pipeline_variables(
        session,
        user,
        arguments=[
            {"name": "top_k", "type": "integer", "default": 5, "minimum": 1, "maximum": 10}
        ],
        outputs=[{"name": "candidates", "expression": "top_k * 2"}],
        retriever_top_k_expression="top_k * 2",
    )

    store = PgvectorStore(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    store.upsert(
        "ragworks",
        f"col-{collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id=f"chunk-{order}",
                text=f"Paris fact {order}.",
                order=order,
                metadata=DocumentMetadata(data={}),
                embedding=[0.1, 0.2, 0.3],
            )
            for order in range(4)
        ],
    )

    response = RetrievalService(session).query_collection(
        user, collection, query="capital of France", arguments={"top_k": 2}
    )

    assert response.outputs == {"candidates": 4}
    # The declared top_k argument (2) caps the fused list even though the
    # retriever over-fetched 4 candidates.
    assert len(response.chunks) == 2

    event = session.get(models.QueryEvent, response.query_event_id)
    assert event is not None
    assert event.response_payload["arguments"] == {"top_k": 2}
    assert event.response_payload["outputs"] == {"candidates": 4}
