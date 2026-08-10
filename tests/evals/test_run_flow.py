"""End-to-end eval run flow against real Postgres with providers stubbed.

Drives the public entry points (`EvalService` + `EvalRunner.execute`) through
dataset upload → provisioning (real ingestion into pgvector) → per-query
retrieval → metrics → funnel. Asserts persisted outcomes through a fresh
session, the eval-collection tagging/reuse contract, and that eval collections
never appear in the user-facing collections listing.
"""

from __future__ import annotations

import httpx
import pytest
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import CollectionRepository, EvalRunRepository
from app.evals.execution.runner import EvalRunner
from app.evals.service import EvalService
from app.pipelines.definition import PipelineEdgeDefinition, PipelineNodeDefinition
from app.providers.throttle import RetryPolicy
from app.schemas.enums import EvalRunStatus
from app.schemas.evals import EvalRunConfig, EvalRunCreate
from app.schemas.evals_usage import EvalRunUsage
from app.services.ingestion import IngestionService
from app.services.pipelines import PipelineService
from app.services.retrieval import RetrievalService
from tests.utils.providers import add_openrouter_connection, install_scaffolded_pipelines


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


class _RateLimitedChatProvider:
    """Chat provider stand-in whose every call answers 429.

    The failure a degraded node is made of: exhausted retries against a
    provider that is up but refusing, which is what a real HyDE step hits.
    """

    name = "stub"

    def get_model(self, _model_id: str):
        return None

    def chat(self, _request):
        request = httpx.Request("POST", "https://provider.test/chat")
        response = httpx.Response(429, request=request)
        raise httpx.HTTPStatusError("rate limited", request=request, response=response)

    def chat_stream(self, _request):
        raise NotImplementedError

    def parse_chat_response(self, _response):
        raise NotImplementedError

    def parse_stream_chunk(self, _chunk):
        raise NotImplementedError


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    def __init__(self, *_args, **_kwargs) -> None:
        self.retry_policy = RetryPolicy(attempts=2, base_delay=0.0, max_delay=0.0)

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return _StubEmbedder(model_name)

    def embedding_input_limit(self, _connection_id, _model_name: str) -> int | None:
        return None

    def chat(self, _connection_id):
        return _RateLimitedChatProvider()

    def request_concurrency(self, _connection_id) -> int:
        return 1

    def request_rpm(self, _connection_id) -> int | None:
        return None


CORPUS = (
    '{"_id": "docA", "title": "Paris", "text": "Paris is the capital of France."}\n'
    '{"_id": "docB", "title": "Rome", "text": "Rome is the capital of Italy."}\n'
    '{"_id": "docC", "title": "Berlin", "text": "Berlin is the capital of Germany."}\n'
)
QUERIES = '{"_id": "q1", "text": "capital of France"}\n{"_id": "q2", "text": "capital of Italy"}\n'
QRELS = "query-id\tcorpus-id\tscore\nq1\tdocA\t1\nq2\tdocB\t1\n"


@pytest.fixture(name="stubbed_providers")
def stubbed_providers_fixture(monkeypatch) -> None:
    """Stub the embedding provider at both ingestion and retrieval boundaries."""
    monkeypatch.setattr("app.services.ingestion.ProviderResolver", _StubProviderResolver)
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="evals@example.com",
        full_name="Eval Tester",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_scaffolded_pipelines(session, user)
    return user


def _default_pipelines(
    session: Session, user: models.User
) -> tuple[models.Pipeline, models.Pipeline]:
    ingestion = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == "default-ingest",
        )
    ).one()
    retrieval = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == "default-search",
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
def test_reuse_ingests_only_the_missing_documents(pg_search_session: Session) -> None:
    """A larger second run with the same ingestion pipeline tops up the
    existing eval collection with only the documents it doesn't hold yet,
    instead of provisioning (and re-ingesting) a whole new collection."""
    session = pg_search_session
    user = _create_user(session)

    first = _start_run(session, user, num_queries=1, distractor_pool_size=0)
    EvalRunner(session).execute(first)
    dataset = session.get(models.EvalDataset, first.dataset_id)
    assert dataset is not None
    with Session(session.get_bind()) as fresh:
        first_docs = {doc.name: doc.id for doc in fresh.exec(select(models.Document)).all()}
    assert len(first_docs) == 1  # one sampled query's single gold document

    service = EvalService(session)
    first_coverage = service.coverage_for([first])[first.id]
    assert (first_coverage.corpus_ingested, first_coverage.corpus_total) == (1, 3)
    assert (first_coverage.queries_done, first_coverage.queries_total) == (1, 2)

    second = _start_run(session, user, dataset=dataset, num_queries=2, distractor_pool_size=1)
    EvalRunner(session).execute(second)

    second_coverage = service.coverage_for([second])[second.id]
    assert (second_coverage.corpus_ingested, second_coverage.corpus_total) == (3, 3)
    assert (second_coverage.queries_done, second_coverage.queries_total) == (2, 2)

    eval_collections = CollectionRepository(session).list_eval_for_user(user.id)
    assert len(eval_collections) == 1  # topped up, not re-provisioned

    with Session(session.get_bind()) as fresh:
        docs = fresh.exec(select(models.Document)).all()
        assert sorted(doc.name for doc in docs) == ["docA.txt", "docB.txt", "docC.txt"]
        # The first run's document was kept, not deleted and re-ingested.
        for doc in docs:
            if doc.name in first_docs:
                assert doc.id == first_docs[doc.name]
        second_stored = fresh.get(models.EvalRun, second.id)
        assert second_stored is not None
        assert second_stored.status == EvalRunStatus.COMPLETED.value
        assert second_stored.aggregate_metrics["recall@10"] == pytest.approx(1.0)


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


@pytest.mark.usefixtures("stubbed_providers")
def test_a_gold_document_that_never_indexed_is_excluded_not_scored_zero(
    pg_search_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An ingestion failure must not be reported as retrieval quality.

    A QA run published recall@10 of 0.99 whose only miss was a corpus document
    that produced zero chunks: the retriever was never given the chance to
    return it, so scoring the query as a miss attributed a corpus problem to
    the pipeline. Such a query is excluded from the aggregate rather than
    scored zero — a zero drags the mean it was supposedly excluded from — and
    counted separately so the exclusion is visible next to the number.
    """
    session = pg_search_session
    user = _create_user(session)
    original = IngestionService.ingest_document

    def failing(self, *, user, collection, document):  # type: ignore[no-untyped-def]
        if document.name.startswith("docA"):
            raise RuntimeError("Model output is not valid JSON: Unterminated string")
        return original(self, user=user, collection=collection, document=document)

    monkeypatch.setattr(IngestionService, "ingest_document", failing)
    run = _start_run(session, user, concurrency=1)

    EvalRunner(session).execute(run)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        assert stored.status == EvalRunStatus.COMPLETED.value
        items = fresh.exec(
            select(models.EvalRunItem).where(models.EvalRunItem.run_id == run.id)
        ).all()
        by_query = {item.query_external_id: item for item in items}

        # q1's only gold is docA, which never reached the index.
        assert by_query["q1"].gold_doc_ids == ["docA"]
        assert by_query["q1"].indexed_gold_doc_ids == []
        assert by_query["q1"].metrics == {}
        assert not by_query["q1"].failed

        # q2's gold did index, so it is scored normally.
        assert by_query["q2"].indexed_gold_doc_ids == ["docB"]
        assert by_query["q2"].metrics

        # The run says so, apart from retrieval failures.
        assert stored.unscored_count == 1
        assert stored.failed_count == 0
        # The aggregate is q2's number alone, not pulled toward zero by q1.
        assert stored.aggregate_metrics["recall@10"] == pytest.approx(1.0)


@pytest.mark.usefixtures("stubbed_providers")
def test_a_later_run_reingests_a_corpus_document_the_first_run_failed(
    pg_search_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failed corpus document is re-attempted by the next run, not skipped.

    The eval collection is cache-keyed by (dataset, ingestion pipeline), and
    the top-up check asks which sampled documents have no row yet. A failed
    ingestion leaves its row behind, so it reads as present — which made one
    bad document permanent for that cache key: every later run reused the
    collection, skipped the document, and reported the gap as coverage
    nothing could repair.
    """
    session = pg_search_session
    user = _create_user(session)
    embed_documents = _StubEmbedder.embed_documents
    embedding_down = True

    def flaky(self, chunks):  # type: ignore[no-untyped-def]
        # docA is the Paris document; the run's other documents embed fine.
        if embedding_down and any("Paris" in chunk.text for chunk in chunks):
            raise RuntimeError("Embedding provider returned 503")
        return embed_documents(self, chunks)

    monkeypatch.setattr(_StubEmbedder, "embed_documents", flaky)
    first = _start_run(session, user, concurrency=1)
    EvalRunner(session).execute(first)
    dataset = session.get(models.EvalDataset, first.dataset_id)
    assert dataset is not None

    with Session(session.get_bind()) as fresh:
        failed_doc = fresh.exec(
            select(models.Document).where(models.Document.name == "docA.txt")
        ).one()
        assert failed_doc.status == models.DocumentStatus.FAILED
        stored_first = fresh.get(models.EvalRun, first.id)
        assert stored_first is not None
        assert stored_first.unscored_count == 1
    assert EvalService(session).coverage_for([first])[first.id].corpus_unindexed == 1

    # The provider recovers; the same configuration runs again.
    embedding_down = False
    second = _start_run(session, user, dataset=dataset, concurrency=1)
    EvalRunner(session).execute(second)

    # Coverage names what a retry would repair, so the UI can offer the action
    # only while there is something to fix — a sampled run is short of
    # `corpus_total` by design and can never gate on that.
    assert EvalService(session).coverage_for([second])[second.id].corpus_unindexed == 0

    assert len(CollectionRepository(session).list_eval_for_user(user.id)) == 1
    with Session(session.get_bind()) as fresh:
        doc_a = fresh.exec(select(models.Document).where(models.Document.name == "docA.txt")).one()
        assert doc_a.status == models.DocumentStatus.READY
        assert doc_a.num_chunks > 0

        stored = fresh.get(models.EvalRun, second.id)
        assert stored is not None
        assert stored.unscored_count == 0
        item = fresh.exec(
            select(models.EvalRunItem).where(
                models.EvalRunItem.run_id == second.id,
                models.EvalRunItem.query_external_id == "q1",
            )
        ).one()
        assert item.indexed_gold_doc_ids == ["docA"]
        assert item.metrics


@pytest.mark.usefixtures("stubbed_providers")
def test_progress_counts_the_phase_that_is_running(pg_search_session: Session) -> None:
    """Corpus documents and queries are different units and never summed.

    Summing them made a 100-document/100-query run read "99/200 Ingesting
    corpus", which states neither how much of the corpus is in nor how many
    queries remain.
    """
    session = pg_search_session
    user = _create_user(session)
    run = _start_run(session, user, concurrency=1)
    seen: list[tuple[str, int]] = []
    original = EvalRunner._provision

    def record_phase(self, run_arg, *args, **kwargs):  # type: ignore[no-untyped-def]
        result = original(self, run_arg, *args, **kwargs)
        seen.append((run_arg.status, run_arg.progress_total))
        return result

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(EvalRunner, "_provision", record_phase)
        EvalRunner(session).execute(run)

    ingesting_total = seen[0][1]
    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        # Three corpus documents while ingesting; two sampled queries after.
        assert ingesting_total == 3
        assert stored.progress_total == 2
        assert stored.progress_done == 2


def _splice_hyde(session: Session, retrieval: models.Pipeline, connection_id) -> None:
    """Insert a HyDE generator between the query input and everything after it.

    The shape the bug was reported on: every downstream branch reads what the
    generator emitted, so a generator that only ever passes its input through
    is invisible in the results.
    """
    service = PipelineService(session)
    definition = service.get_definition(retrieval)
    hyde = PipelineNodeDefinition(
        id="hyde",
        type="llm.generate",
        name="HyDE",
        config={
            "connection_id": str(connection_id),
            "model_name": "stub-model",
            "prompt": "Write a passage answering: {{text}}",
            "output_fields": [
                {"name": "passages", "type": "string_list", "target": {"kind": "items"}}
            ],
        },
    )
    edges = [
        edge.model_copy(update={"source": "hyde"}) if edge.source == "query-input" else edge
        for edge in definition.edges
    ]
    edges.append(
        PipelineEdgeDefinition(
            id="edge-hyde",
            source="query-input",
            target="hyde",
            source_port="items",
            target_port="items",
        )
    )
    service.update_pipeline(
        pipeline=retrieval,
        definition=definition.model_copy(
            update={"nodes": [*definition.nodes, hyde], "edges": edges}
        ),
        actor_id=retrieval.user_id,
    )
    session.commit()


@pytest.mark.usefixtures("stubbed_providers")
def test_a_degraded_query_node_is_flagged_on_the_run_and_its_queries(
    pg_search_session: Session,
) -> None:
    """A run whose HyDE step never executed must not read as a clean run.

    Every query still returns results — the generator passes the original
    query through — so nothing in the metrics says the pipeline under test
    is not the pipeline that ran. The degraded flags are that signal.
    """
    session = pg_search_session
    user = _create_user(session)
    connection = add_openrouter_connection(session, user)
    _ingestion, retrieval = _default_pipelines(session, user)
    _splice_hyde(session, retrieval, connection.id)
    run = _start_run(session, user, concurrency=1)

    EvalRunner(session).execute(run)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        # The run completed and produced real metrics — that is the trap.
        assert stored.status == EvalRunStatus.COMPLETED.value
        assert stored.failed_count == 0
        assert stored.degraded_count == 2
        items = fresh.exec(
            select(models.EvalRunItem).where(models.EvalRunItem.run_id == run.id)
        ).all()
        assert all(item.degraded for item in items)
        assert all(item.result_count > 0 for item in items)
        # And the pipeline run behind each query says the same thing.
        node_runs = fresh.exec(
            select(models.PipelineNodeRun).where(
                models.PipelineNodeRun.run_id == items[0].pipeline_run_id
            )
        ).all()
        degraded = [row for row in node_runs if row.node_id == "hyde"]
        assert [row.status for row in degraded] == [models.PipelineRunStatus.DEGRADED]


@pytest.mark.usefixtures("stubbed_providers")
def test_a_run_records_the_embedding_tokens_it_spent(pg_search_session: Session) -> None:
    """Ingestion and query embedding usage both land on the run's totals."""
    session = pg_search_session
    user = _create_user(session)
    run = _start_run(session, user)

    EvalRunner(session).execute(run)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        usage = EvalRunUsage.model_validate(stored.usage_summary)
        # The stub embedder reports 3 tokens per call: one ingestion call per
        # corpus document, one query call per evaluated query.
        assert usage.ingestion.total_tokens == 3 * 3
        assert usage.retrieval.total_tokens == 3 * 2
        # No connected provider publishes pricing for the stub model.
        assert usage.ingestion.cost_usd is None


@pytest.mark.usefixtures("stubbed_providers")
def test_a_reused_eval_collection_charges_the_run_no_ingestion(
    pg_search_session: Session,
) -> None:
    """Ingestion spend is attributed to the run that performed it, not to reuse."""
    session = pg_search_session
    user = _create_user(session)

    first = _start_run(session, user, num_queries=2, distractor_pool_size=1)
    EvalRunner(session).execute(first)
    dataset = session.get(models.EvalDataset, first.dataset_id)
    assert dataset is not None

    second = _start_run(session, user, dataset=dataset, num_queries=2, distractor_pool_size=1)
    EvalRunner(session).execute(second)

    with Session(session.get_bind()) as fresh:
        first_stored = fresh.get(models.EvalRun, first.id)
        second_stored = fresh.get(models.EvalRun, second.id)
        assert first_stored is not None
        assert second_stored is not None
        first_usage = EvalRunUsage.model_validate(first_stored.usage_summary)
        assert first_usage.ingestion.total_tokens == 9
        reused = EvalRunUsage.model_validate(second_stored.usage_summary)
        assert reused.ingestion.is_empty()
        assert reused.retrieval.total_tokens == 6


@pytest.mark.usefixtures("stubbed_providers")
def test_a_run_that_dies_mid_queries_keeps_the_spend_it_incurred(
    pg_search_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failed run records the ingestion and query tokens it already spent.

    The cost of a half-finished run is exactly what a reader investigating the
    failure needs, so usage is committed on every progress beat rather than
    only on the success path.
    """
    session = pg_search_session
    user = _create_user(session)
    run = _start_run(session, user)

    original = EvalRunRepository.add_item
    calls = {"n": 0}

    def failing(self: EvalRunRepository, item: models.EvalRunItem) -> models.EvalRunItem:
        calls["n"] += 1
        if calls["n"] > 1:
            raise RuntimeError("run died mid-queries")
        return original(self, item)

    monkeypatch.setattr(EvalRunRepository, "add_item", failing)

    with pytest.raises(RuntimeError, match="run died mid-queries"):
        EvalRunner(session).execute(run)

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalRun, run.id)
        assert stored is not None
        assert stored.status == EvalRunStatus.FAILED.value
        usage = EvalRunUsage.model_validate(stored.usage_summary)
        # Every corpus document was ingested before the query phase started.
        assert usage.ingestion.total_tokens == 9
        # The one query that completed before the failure.
        assert usage.retrieval.total_tokens == 3
