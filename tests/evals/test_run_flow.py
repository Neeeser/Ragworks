"""End-to-end eval run flow against real Postgres with providers stubbed.

Drives the public entry points (`EvalService` + `EvalRunner.execute`) through
dataset upload → provisioning (real ingestion into pgvector) → per-query
retrieval → metrics → funnel. Asserts persisted outcomes through a fresh
session, the eval-collection tagging/reuse contract, and that eval collections
never appear in the user-facing collections listing.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import CollectionRepository
from app.evals.execution.runner import EvalRunner
from app.evals.service import EvalService
from app.schemas.enums import EvalRunStatus
from app.schemas.evals import EvalRunConfig, EvalRunCreate
from app.services.retrieval import RetrievalService
from tests.utils.providers import install_default_pipelines


class _StubEmbedder:
    """Embedder stand-in returning fixed 3-dimension vectors."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 3, "total_tokens": 3}

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

    def embedding_input_limit(self, _connection_id, _model_name: str) -> int | None:
        return None


CORPUS = (
    '{"_id": "docA", "title": "Paris", "text": "Paris is the capital of France."}\n'
    '{"_id": "docB", "title": "Rome", "text": "Rome is the capital of Italy."}\n'
    '{"_id": "docC", "title": "Berlin", "text": "Berlin is the capital of Germany."}\n'
)
QUERIES = (
    '{"_id": "q1", "text": "capital of France"}\n'
    '{"_id": "q2", "text": "capital of Italy"}\n'
)
QRELS = "query-id\tcorpus-id\tscore\nq1\tdocA\t1\nq2\tdocB\t1\n"


@pytest.fixture(name="stubbed_providers")
def stubbed_providers_fixture(monkeypatch) -> None:
    """Stub the embedding provider at both ingestion and retrieval boundaries."""
    monkeypatch.setattr(
        "app.services.ingestion.ProviderResolver", _StubProviderResolver
    )
    monkeypatch.setattr(
        "app.services.retrieval.ProviderResolver", _StubProviderResolver
    )


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="evals@example.com",
        full_name="Eval Tester",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def _default_pipelines(session: Session, user: models.User) -> tuple[models.Pipeline, models.Pipeline]:
    ingestion = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.kind == models.PipelineKind.INGESTION,
        )
    ).one()
    retrieval = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.kind == models.PipelineKind.RETRIEVAL,
        )
    ).one()
    return ingestion, retrieval


def _start_run(
    session: Session,
    user: models.User,
    dataset: models.EvalDataset | None = None,
    **config_overrides: object,
) -> models.EvalRun:
    """Upload the small dataset (unless given one) and create a pending run."""
    service = EvalService(session)
    if dataset is None:
        dataset = service.upload_dataset(
            user, name="Capitals", corpus=CORPUS, queries=QUERIES, qrels=QRELS
        )
    ingestion, retrieval = _default_pipelines(session, user)
    config: dict[str, object] = {
        "num_queries": 2,
        "distractor_pool_size": 1,
        "seed": 0,
        "k_values": [1, 5, 10],
        "selected_metrics": [],
        "run_inputs": {},
    }
    config.update(config_overrides)
    return service.create_run(
        user,
        EvalRunCreate(
            dataset_id=dataset.id,
            ingestion_pipeline_id=ingestion.id,
            retrieval_pipeline_id=retrieval.id,
            config=EvalRunConfig.model_validate(config),
        ),
    )


@pytest.mark.parametrize("concurrency", [1, 3])
@pytest.mark.usefixtures("stubbed_providers")
def test_eval_run_end_to_end(pg_search_session: Session, concurrency: int) -> None:
    """A run provisions, ingests, evaluates every query, and aggregates.

    Parametrized over the worker-pool size: 1 pins the serial path, 3 pins
    pooled ingestion and evaluation (workers in their own sessions).
    """
    session = pg_search_session
    user = _create_user(session)
    run = _start_run(session, user, concurrency=concurrency)

    EvalRunner(session).execute(run)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        assert stored.status == EvalRunStatus.COMPLETED.value
        assert stored.progress_done == stored.progress_total
        assert stored.completed_at is not None

        items = fresh.exec(
            select(models.EvalRunItem).where(models.EvalRunItem.run_id == run.id)
        ).all()
        assert len(items) == 2
        assert all(not item.failed for item in items)
        assert all(item.pipeline_run_id is not None for item in items)
        assert all(item.query_event_id is not None for item in items)
        assert all(item.result_count > 0 for item in items)
        # Every item's per-node journey starts at the ingestion sentinel so the
        # UI can render a per-document indexed→retrieved→kept path.
        for item in items:
            assert item.per_node_funnel[0]["node_id"] == "ingestion"
            assert len(item.per_node_funnel) > 1

        # With 3 tiny docs indexed and top_k=10, every gold doc is retrieved.
        assert stored.aggregate_metrics["recall@10"] == pytest.approx(1.0)
        assert stored.aggregate_metrics["hit@10"] == pytest.approx(1.0)
        assert "ndcg@5" in stored.aggregate_metrics

        # Funnel: ingestion coverage plus at least one node-addressed stage.
        stages = stored.funnel_summary["stages"]
        stage_ids = [stage["node_id"] for stage in stages]
        assert stage_ids[0] == "ingestion"
        assert len(stage_ids) > 1
        ingestion_stage = stages[0]
        assert ingestion_stage["retention"] == pytest.approx(1.0)

        # The eval collection is tagged and carries the corpus documents.
        collection = fresh.get(models.Collection, stored.eval_collection_id)
        assert collection is not None
        assert collection.system_purpose == "eval"


@pytest.mark.usefixtures("stubbed_providers")
def test_relevance_zero_judgments_are_not_gold(pg_search_session: Session) -> None:
    """Qrels rows with relevance 0 (judged NOT relevant) never enter the gold set.

    q1 carries an explicit 0-score judgment for docC and q3's only judgment is a
    0-score row: docC must not count as gold for q1, and q3 must be treated as
    unanswerable rather than sampled.
    """
    session = pg_search_session
    user = _create_user(session)
    dataset = EvalService(session).upload_dataset(
        user,
        name="Capitals with zero qrels",
        corpus=CORPUS,
        queries=QUERIES + '{"_id": "q3", "text": "capital of Spain"}\n',
        qrels=QRELS + "q1\tdocC\t0\nq3\tdocA\t0\n",
    )
    run = _start_run(session, user, dataset=dataset, num_queries=3, concurrency=1)

    EvalRunner(session).execute(run)

    with Session(session.get_bind()) as fresh:
        items = fresh.exec(
            select(models.EvalRunItem).where(models.EvalRunItem.run_id == run.id)
        ).all()
        by_query = {item.query_external_id: item for item in items}
        assert set(by_query) == {"q1", "q2"}  # q3 has no positive judgment
        assert by_query["q1"].gold_doc_ids == ["docA"]  # docC's 0-row is not gold
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        assert stored.aggregate_metrics["recall@10"] == pytest.approx(1.0)


@pytest.mark.usefixtures("stubbed_providers")
def test_failed_queries_are_recorded_and_counted(
    pg_search_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failed retrieval is one failed item, and the run reports how many.

    Aggregates mean only the successfully evaluated queries, so `failed_count`
    must be persisted beside them — otherwise a run with heavy provider
    failures silently reports survivor-only numbers as if they covered every
    sampled query.
    """
    session = pg_search_session
    user = _create_user(session)
    original = RetrievalService.query_collection

    def flaky(self, user_arg, collection, query, **kwargs):  # type: ignore[no-untyped-def]
        if "Italy" in query:
            raise RuntimeError("provider down")
        return original(self, user_arg, collection, query, **kwargs)

    monkeypatch.setattr(RetrievalService, "query_collection", flaky)
    run = _start_run(session, user, concurrency=1)

    EvalRunner(session).execute(run)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        assert stored.status == EvalRunStatus.COMPLETED.value
        assert stored.failed_count == 1
        items = fresh.exec(
            select(models.EvalRunItem).where(models.EvalRunItem.run_id == run.id)
        ).all()
        by_query = {item.query_external_id: item for item in items}
        assert by_query["q2"].failed
        assert "provider down" in (by_query["q2"].error_message or "")
        assert stored.aggregate_metrics["recall@10"] == pytest.approx(1.0)


@pytest.mark.usefixtures("stubbed_providers")
def test_eval_collections_are_hidden_and_reused(pg_search_session: Session) -> None:
    """Same ingestion pipeline → the ingested collection is reused, and eval
    collections never surface in the user-facing collections listing."""
    session = pg_search_session
    user = _create_user(session)

    first = _start_run(session, user)
    EvalRunner(session).execute(first)
    dataset = session.get(models.EvalDataset, first.dataset_id)
    assert dataset is not None
    second = _start_run(session, user, dataset=dataset)
    EvalRunner(session).execute(second)

    repo = CollectionRepository(session)
    assert repo.list_for_user(user.id) == []
    eval_collections = repo.list_eval_for_user(user.id)
    assert len(eval_collections) == 1  # reused, not re-provisioned

    with Session(session.get_bind()) as fresh:
        first_stored = fresh.get(models.EvalRun, first.id)
        second_stored = fresh.get(models.EvalRun, second.id)
        assert first_stored is not None
        assert second_stored is not None
        assert first_stored.eval_collection_id == second_stored.eval_collection_id
        assert second_stored.status == EvalRunStatus.COMPLETED.value
