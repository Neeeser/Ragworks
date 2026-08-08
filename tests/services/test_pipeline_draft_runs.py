"""Behavior of `PipelineDraftRunService` — the editor's run-a-draft path.

What matters here is that a draft runs *as drafted* without becoming a saved
version, that a draft the validator refuses says why against its own fields,
and that a run failing at a provider still comes back as a trace naming the
node that failed.
"""

from __future__ import annotations

import pytest
from pinecone.exceptions import PineconeException
from sqlalchemy import text
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import PipelineRunRepository
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.pipelines.definition import PipelineDefinition
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.pipelines import PipelineDraftRunRequest
from app.services.pipeline_draft_runs import (
    PipelineDraftInvalidError,
    PipelineDraftRunService,
)
from app.services.pipelines import PipelineService
from app.vectorstores.base import IndexSpec
from tests.utils.providers import TEST_EMBED_CONNECTION_ID, install_default_pipelines
from tests.utils.vectors import pgvector_store


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


class _OutageEmbedder(_StubEmbedder):
    """Embedder whose query call fails the way a provider outage does."""

    def embed_query(self, _query: str):
        raise PineconeException("upstream is unavailable")


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    embedder_class = _StubEmbedder

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return self.embedder_class(model_name)


class _OutageProviderResolver(_StubProviderResolver):
    embedder_class = _OutageEmbedder


def _user(session: Session) -> models.User:
    user = models.User(
        email="draft-run@example.com",
        full_name="Draft Runner",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def _collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _retrieval_pipeline(session: Session, user: models.User) -> models.Pipeline:
    return PipelineService(session).ensure_default_pipelines(user).retrieval


def _definition(session: Session, pipeline: models.Pipeline) -> PipelineDefinition:
    service = PipelineService(session)
    return PipelineDefinition.model_validate(service.get_current_version(pipeline).definition)


def _seed_index(session: Session, collection: models.Collection) -> None:
    store = pgvector_store(session)
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


def test_draft_run_traces_the_edited_graph_without_saving_a_version(
    monkeypatch, pgvector_session: Session
) -> None:
    """The run executes the draft the editor holds — the renamed node reaches
    the trace — while the pipeline's saved version count is untouched."""
    session = pgvector_session
    monkeypatch.setattr(
        "app.services.pipeline_draft_runs.ProviderResolver", _StubProviderResolver
    )
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    saved_version = pipeline.current_version
    _seed_index(session, collection)

    draft = _definition(session, pipeline)
    edited = next(node for node in draft.nodes if node.type == "retrieval.input")
    edited.name = "Draft query input"

    response = PipelineDraftRunService(session).run(
        user,
        pipeline,
        collection,
        PipelineDraftRunRequest(
            definition=draft, collection_id=collection.id, query="capital of France"
        ),
    )

    assert response.failure is None
    assert response.trace.run.status == models.PipelineRunStatus.COMPLETED
    # The trace describes the draft, not the saved graph.
    names = [node.name for node in response.trace.definition.nodes]
    assert "Draft query input" in names
    assert [run.node_id for run in response.trace.node_runs]
    assert response.trace.node_io

    session.refresh(pipeline)
    assert pipeline.current_version == saved_version
    versions = session.exec(
        select(models.PipelineVersion).where(models.PipelineVersion.pipeline_id == pipeline.id)
    ).all()
    assert len(versions) == saved_version
    # A draft run is a test, not traffic: no query event, so the collection's
    # own analytics stay a record of real queries.
    assert session.exec(select(models.QueryEvent)).all() == []


def test_draft_run_records_the_run_with_no_version(
    monkeypatch, pgvector_session: Session
) -> None:
    """The run row names the pipeline being edited and no version, so nothing
    later reads it as having executed a saved graph."""
    session = pgvector_session
    monkeypatch.setattr(
        "app.services.pipeline_draft_runs.ProviderResolver", _StubProviderResolver
    )
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    _seed_index(session, collection)

    response = PipelineDraftRunService(session).run(
        user,
        pipeline,
        collection,
        PipelineDraftRunRequest(
            definition=_definition(session, pipeline),
            collection_id=collection.id,
            query="capital of France",
        ),
    )

    assert response.trace.run.pipeline_id == pipeline.id
    assert response.trace.run.pipeline_version_id is None
    assert response.trace.run.pipeline_version is None


def test_invalid_draft_is_refused_with_its_field_issues(session: Session) -> None:
    """A draft the validator rejects comes back as issues, never as a run."""
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    draft = _definition(session, pipeline)
    # An edge into a port that does not exist: a graph-level error the client
    # checks cannot see, which is the reason the server validates the draft.
    draft.edges = [
        *draft.edges,
        draft.edges[0].model_copy(update={"id": "draft-broken-edge", "target_port": "nonsense"}),
    ]

    with pytest.raises(PipelineDraftInvalidError) as caught:
        PipelineDraftRunService(session).run(
            user,
            pipeline,
            collection,
            PipelineDraftRunRequest(
                definition=draft, collection_id=collection.id, query="anything"
            ),
        )

    detail = caught.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "pipeline_draft_invalid"
    # A graph-level error addresses no field, so it must reach the client as
    # an error string rather than being dropped with the empty issue list.
    assert detail["errors"]
    assert session.exec(select(models.PipelineRun)).all() == []


def test_ingestion_draft_is_refused_as_having_no_query_input(session: Session) -> None:
    """Ingestion graphs have nothing to run a sample query through."""
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)

    with pytest.raises(PipelineDraftInvalidError) as caught:
        PipelineDraftRunService(session).run(
            user,
            pipeline,
            collection,
            PipelineDraftRunRequest(
                definition=build_default_ingestion_pipeline(
                    embedding_connection_id=TEST_EMBED_CONNECTION_ID,
                    embedding_model="test-embed",
                ),
                collection_id=collection.id,
                query="anything",
            ),
        )

    detail = caught.value.detail
    assert isinstance(detail, dict)
    assert "no query input" in detail["message"]


def test_provider_failure_returns_the_trace_naming_the_failed_node(
    monkeypatch, pgvector_session: Session
) -> None:
    """A run that dies at a provider is still an answer: the trace comes back
    with the failed node named, because that is what the editor asked."""
    session = pgvector_session
    monkeypatch.setattr(
        "app.services.pipeline_draft_runs.ProviderResolver", _OutageProviderResolver
    )
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    _seed_index(session, collection)

    response = PipelineDraftRunService(session).run(
        user,
        pipeline,
        collection,
        PipelineDraftRunRequest(
            definition=_definition(session, pipeline),
            collection_id=collection.id,
            query="capital of France",
        ),
    )

    assert response.failure is not None
    assert response.failure.failed_node is not None
    assert response.failure.pipeline_run_id == response.trace.run.id
    assert response.trace.run.status == models.PipelineRunStatus.FAILED
    failed = [
        run for run in response.trace.node_runs if run.status == models.PipelineRunStatus.FAILED
    ]
    assert [run.node_id for run in failed] == [response.failure.failed_node.node_id]


class _WideEmbedder(_StubEmbedder):
    """Embedder whose query vector is wider than the index it is queried against."""

    def embed_query(self, _query: str):
        return [0.1, 0.2, 0.3, 0.4, 0.5]


class _WideProviderResolver(_StubProviderResolver):
    embedder_class = _WideEmbedder


def test_database_failure_returns_the_trace_rather_than_raising(
    monkeypatch, pgvector_session: Session
) -> None:
    """A mid-run DB error aborts the transaction; the trace must still come back."""
    session = pgvector_session
    monkeypatch.setattr("app.services.pipeline_draft_runs.ProviderResolver", _WideProviderResolver)
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    _seed_index(session, collection)

    response = PipelineDraftRunService(session).run(
        user,
        pipeline,
        collection,
        PipelineDraftRunRequest(
            definition=_definition(session, pipeline),
            collection_id=collection.id,
            query="capital of France",
        ),
    )

    assert response.failure is not None
    assert response.failure.failed_node is not None
    assert response.trace.run.status == models.PipelineRunStatus.FAILED
    # The failing node's own row survives the savepoint rollback, so the
    # persisted trace names the same node the failure detail does.
    failed = [
        run for run in response.trace.node_runs if run.status == models.PipelineRunStatus.FAILED
    ]
    assert [run.node_id for run in failed] == [response.failure.failed_node.node_id]


def test_a_failed_draft_run_is_not_a_recent_retrieval_failure(
    monkeypatch, pgvector_session: Session
) -> None:
    """A draft the user is still tuning fails on purpose; the collection's
    diagnostics must keep reporting only the failures its users hit."""
    session = pgvector_session
    monkeypatch.setattr(
        "app.services.pipeline_draft_runs.ProviderResolver", _OutageProviderResolver
    )
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    _seed_index(session, collection)

    response = PipelineDraftRunService(session).run(
        user,
        pipeline,
        collection,
        PipelineDraftRunRequest(
            definition=_definition(session, pipeline),
            collection_id=collection.id,
            query="capital of France",
        ),
    )
    assert response.failure is not None

    listed = PipelineRunRepository(session).list_recent_for_collection(
        collection.id,
        models.BindingRole.TOOL,
        status=models.PipelineRunStatus.FAILED,
    )
    assert listed == []
    # Still readable by id, which is how the editor's own panel reads it.
    assert PipelineRunRepository(session).get(response.trace.run.id) is not None


def test_draft_runs_are_pruned_to_the_history_cap(monkeypatch, pgvector_session: Session) -> None:
    """Editor runs are unbounded clicks, so the oldest are deleted on write."""
    session = pgvector_session
    monkeypatch.setattr(
        "app.services.pipeline_draft_runs.ProviderResolver", _StubProviderResolver
    )
    monkeypatch.setattr("app.services.pipeline_draft_runs.DRAFT_RUN_HISTORY", 2)
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    _seed_index(session, collection)

    for _ in range(4):
        PipelineDraftRunService(session).run(
            user,
            pipeline,
            collection,
            PipelineDraftRunRequest(
                definition=_definition(session, pipeline),
                collection_id=collection.id,
                query="capital of France",
            ),
        )

    session.commit()
    with Session(session.get_bind()) as fresh:
        runs = fresh.exec(select(models.PipelineRun)).all()
        assert len(runs) == 2
        assert fresh.exec(select(models.PipelineNodeRun)).all()


def test_a_failing_prune_still_returns_the_run_and_leaves_the_session_usable(
    monkeypatch, pgvector_session: Session
) -> None:
    """Housekeeping must never cost the user the trace they asked for.

    The prune is a DELETE inside the request that built the response, so a
    database-level failure there aborts the transaction. Catching it is not
    enough on its own: the session can no longer commit, so the run this
    response describes is discarded with it and the trace the client just
    received names a row that does not exist. The savepoint is what unwinds
    the prune alone.
    """
    session = pgvector_session
    monkeypatch.setattr(
        "app.services.pipeline_draft_runs.ProviderResolver", _StubProviderResolver
    )
    user = _user(session)
    collection = _collection(session, user)
    pipeline = _retrieval_pipeline(session, user)
    _seed_index(session, collection)

    def _explode(self, _pipeline_id, *, keep: int) -> None:
        """Fail the way a real DELETE against a poisoned row does."""
        del keep
        self.session.exec(text("SELECT * FROM pipeline_runs WHERE no_such_column = 1"))

    monkeypatch.setattr(PipelineRunRepository, "prune_draft_runs", _explode)

    response = PipelineDraftRunService(session).run(
        user,
        pipeline,
        collection,
        PipelineDraftRunRequest(
            definition=_definition(session, pipeline),
            collection_id=collection.id,
            query="capital of France",
        ),
    )

    # The run itself is unaffected: the trace came back.
    assert response.failure is None
    assert response.trace.run.status == models.PipelineRunStatus.COMPLETED

    # The transaction survived, so the request's own commit succeeds and the
    # run is actually persisted.
    session.commit()
    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.PipelineRun, response.trace.run.id)
        assert stored is not None
        assert stored.is_draft is True
