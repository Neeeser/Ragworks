"""Synthetic generation flow: generating → ready/failed, with the provider stubbed.

Drives `run_dataset_generation` against real Postgres rows with a scripted
chat provider at the boundary (the seam the generator actually uses:
`resolve_connection`/`get_provider` in its own module).
"""

from __future__ import annotations

import json
import re

import pytest
from sqlmodel import Session, select

from app.db import models
from app.evals.generation import run_dataset_generation
from app.evals.generation.requests import create_generation_dataset
from app.providers.chat.base import ChatRequest, ParsedChatResponse
from app.schemas.enums import ChunkStrategy, DocumentStatus, EvalDatasetStatus
from app.schemas.evals_generation import EvalDatasetGenerateRequest
from app.services.errors import InvalidInputError, NotFoundError

_EMBED_MODEL = "qwen/qwen3-embedding-0.6b"


def _user(session: Session, email: str = "gen@example.com") -> models.User:
    user = models.User(email=email, full_name="G", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _connection(session: Session, user: models.User) -> models.ProviderConnection:
    connection = models.ProviderConnection(
        user_id=user.id,
        provider_type="openrouter",
        label="OpenRouter",
        config={"api_key": "sk-test"},
    )
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return connection


def _collection_with_documents(
    session: Session, user: models.User, *, docs: int = 2, chunks_per_doc: int = 6
) -> models.Collection:
    collection = models.Collection(name="Papers", user_id=user.id)
    session.add(collection)
    session.commit()
    session.refresh(collection)
    for doc_index in range(docs):
        document = models.Document(
            collection_id=collection.id,
            user_id=user.id,
            name=f"doc-{doc_index}.txt",
            content_type="text/plain",
            status=DocumentStatus.READY,
            num_chunks=chunks_per_doc,
            num_tokens=100,
            chunk_size=512,
            chunk_overlap=0,
            chunk_strategy=ChunkStrategy.TOKEN,
            embedding_model=_EMBED_MODEL,
        )
        session.add(document)
        session.commit()
        session.refresh(document)
        session.add_all(
            [
                models.DocumentChunkRecord(
                    document_id=document.id,
                    collection_id=collection.id,
                    chunk_index=index,
                    text=(
                        f"Document {doc_index} section {index} explains topic"
                        f" {doc_index}-{index} in careful detail."
                    ),
                    embedding=[],
                    chunk_size=512,
                    chunk_overlap=0,
                    chunk_strategy=ChunkStrategy.TOKEN,
                    embedding_model=_EMBED_MODEL,
                    token_count=12,
                )
                for index in range(chunks_per_doc)
            ]
        )
        session.commit()
    return collection


def _payload(
    collection: models.Collection,
    connection: models.ProviderConnection,
    *,
    num_questions: int = 4,
) -> EvalDatasetGenerateRequest:
    return EvalDatasetGenerateRequest(
        name="Synthetic set",
        collection_id=collection.id,
        connection_id=connection.id,
        model_name="test/model",
        num_questions=num_questions,
        seed=7,
    )


_DISTINCT_QUESTIONS = [
    "Which budget line covers embedding costs?",
    "How is the caching layer invalidated after deploys?",
    "Who signs off on rollout freezes during peak season?",
    "When does the retention window purge stored traces?",
    "What throughput did the ingestion benchmark reach?",
    "Where are provider credentials persisted at rest?",
    "Why did the reranker demote long documents?",
    "Can namespaces be shared across two pipelines safely?",
    "Should sparse indexes mirror the dense naming rule?",
    "Does the tokenizer prefetch run before validation?",
]


class _ScriptedChat:
    """A chat provider double: unique candidates per context, scripted scores.

    Each generation call yields two candidates quoting the real context (one
    later fails critique), so acceptance advances exactly one question per
    context and the accept/reject paths both execute. Question texts come
    from a bank of genuinely distinct sentences so the dedup gate ignores
    them.
    """

    def __init__(self) -> None:
        self.calls = 0
        self._counter = 0

    def chat(self, request: ChatRequest) -> dict[str, object]:
        self.calls += 1
        prompt = str(request.messages[-1]["content"])
        if "Score each candidate" in prompt:
            count = len(re.findall(r"^\d+\. question:", prompt, flags=re.MULTILINE))
            rows = [{"groundedness": 5, "standalone": 5, "realism": 5}] * (count - 1)
            rows.append({"groundedness": 2, "standalone": 5, "realism": 5})
            return {"content": json.dumps(rows)}
        context = prompt.split("CONTEXT:\n", 1)[1].split("\n\nReply with", 1)[0]
        quote = context[:60]
        accepted_text = _DISTINCT_QUESTIONS[self._counter % len(_DISTINCT_QUESTIONS)]
        self._counter += 1
        items = [
            {"question": accepted_text, "answer": "A topic.", "quote": quote},
            {
                "question": f"Ignored duplicate probe {self._counter}?",
                "answer": "A topic.",
                "quote": quote,
            },
        ]
        return {"content": json.dumps(items)}

    def parse_chat_response(self, response: dict[str, object]) -> ParsedChatResponse:
        return ParsedChatResponse(
            message={"role": "assistant", "content": response["content"]},
            usage={},
            provider="scripted",
            response_model="test/model",
        )


class _Adapter:
    """Provider-adapter double exposing only what the generator touches."""

    def __init__(self, chat: _ScriptedChat) -> None:
        self._chat = chat

    def chat_provider(self) -> _ScriptedChat:
        return self._chat


def _wire(monkeypatch: pytest.MonkeyPatch, session: Session, chat: _ScriptedChat) -> None:
    monkeypatch.setattr(
        "app.evals.generation.generator.session_scope", lambda: _scope(session)
    )
    monkeypatch.setattr(
        "app.evals.generation.generator.resolve_connection",
        lambda _session, _user, _cid: object(),
    )
    monkeypatch.setattr(
        "app.evals.generation.generator.get_provider",
        lambda _connection, _kind: _Adapter(chat),
    )


class TestCreateGenerationDataset:
    """Request-time validation."""

    def test_records_generating_row_with_config(self, session: Session) -> None:
        """A valid request lands a generating synthetic row with the config."""
        user = _user(session)
        collection = _collection_with_documents(session, user)
        connection = _connection(session, user)
        dataset = create_generation_dataset(
            session, user, _payload(collection, connection)
        )
        assert dataset.status == EvalDatasetStatus.GENERATING.value
        assert dataset.source == "synthetic"
        assert dataset.source_ref == str(collection.id)
        assert dataset.progress_total == 4
        assert dataset.generation_config is not None
        assert dataset.generation_config["model_name"] == "test/model"

    def test_rejects_foreign_collection(self, session: Session) -> None:
        """Another user's collection is indistinguishable from a missing one."""
        owner = _user(session)
        intruder = _user(session, email="other@example.com")
        collection = _collection_with_documents(session, owner)
        connection = _connection(session, intruder)
        with pytest.raises(NotFoundError):
            create_generation_dataset(
                session, intruder, _payload(collection, connection)
            )

    def test_rejects_empty_collection(self, session: Session) -> None:
        """A collection with no ingested chunks cannot seed generation."""
        user = _user(session)
        collection = models.Collection(name="Empty", user_id=user.id)
        session.add(collection)
        session.commit()
        session.refresh(collection)
        connection = _connection(session, user)
        with pytest.raises(InvalidInputError):
            create_generation_dataset(session, user, _payload(collection, connection))


class TestRunDatasetGeneration:
    """The background generate→filter loop against real rows."""

    def test_generates_a_ready_dataset(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The happy path lands a ready dataset: corpus, queries, qrels, stats."""
        user = _user(session)
        collection = _collection_with_documents(session, user)
        connection = _connection(session, user)
        dataset = create_generation_dataset(
            session, user, _payload(collection, connection)
        )
        chat = _ScriptedChat()
        _wire(monkeypatch, session, chat)

        run_dataset_generation(dataset.id)

        with Session(session.get_bind()) as fresh:
            stored = fresh.get(models.EvalDataset, dataset.id)
            assert stored is not None
            assert stored.status == EvalDatasetStatus.READY.value
            assert stored.num_queries == 4
            assert stored.progress_done == 4
            assert stored.num_corpus_docs == 2
            config = stored.generation_config or {}
            assert config["stats"]["accepted"] == 4
            assert config["stats"]["generated"] >= 4
            _assert_triple_shape(fresh, dataset.id, collection.id)

    def test_spreads_acceptance_across_documents(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """No document exceeds its acceptance share even when every candidate passes.

        A greedy model (three all-passing candidates per context) must not let
        the first few sampled documents fill the whole target: acceptances per
        document stay within the per-document cap, so an 8-question dataset
        over 8 documents draws from at least 4 of them.
        """
        user = _user(session)
        collection = _collection_with_documents(session, user, docs=8, chunks_per_doc=4)
        connection = _connection(session, user)
        dataset = create_generation_dataset(
            session, user, _payload(collection, connection, num_questions=8)
        )

        class _GreedyChat(_ScriptedChat):
            """Every generation call yields three candidates that all pass."""

            def chat(self, request: ChatRequest) -> dict[str, object]:
                self.calls += 1
                prompt = str(request.messages[-1]["content"])
                if "Score each candidate" in prompt:
                    count = len(
                        re.findall(r"^\d+\. question:", prompt, flags=re.MULTILINE)
                    )
                    rows = [{"groundedness": 5, "standalone": 5, "realism": 5}] * count
                    return {"content": json.dumps({"scores": rows})}
                context = prompt.split("CONTEXT:\n", 1)[1].split("\n\nReply with", 1)[0]
                items = []
                for _ in range(3):
                    text = _DISTINCT_QUESTIONS[self._counter % len(_DISTINCT_QUESTIONS)]
                    items.append(
                        {
                            "question": f"{text} (variant {self._counter})",
                            "answer": "A topic.",
                            "quote": context[:60],
                        }
                    )
                    self._counter += 1
                return {"content": json.dumps({"candidates": items})}

        _wire(monkeypatch, session, _GreedyChat())

        run_dataset_generation(dataset.id)

        with Session(session.get_bind()) as fresh:
            stored = fresh.get(models.EvalDataset, dataset.id)
            assert stored is not None
            assert stored.status == EvalDatasetStatus.READY.value
            qrels = fresh.exec(
                select(models.EvalRelevanceJudgment).where(
                    models.EvalRelevanceJudgment.dataset_id == dataset.id
                )
            ).all()
            per_doc: dict[str, int] = {}
            for qrel in qrels:
                per_doc[qrel.doc_external_id] = per_doc.get(qrel.doc_external_id, 0) + 1
            assert max(per_doc.values()) <= 2
            assert len(per_doc) >= 4
            stats = (stored.generation_config or {})["stats"]
            assert stats["documents_covered"] == len(per_doc)
            assert stats["documents_total"] == 8

    def test_calls_carry_structured_output_schemas(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Both call kinds enforce their shape via `response_format`, not prompt text."""
        user = _user(session)
        collection = _collection_with_documents(session, user)
        connection = _connection(session, user)
        dataset = create_generation_dataset(
            session, user, _payload(collection, connection)
        )

        requests: list[ChatRequest] = []

        class _RecordingChat(_ScriptedChat):
            def chat(self, request: ChatRequest) -> dict[str, object]:
                requests.append(request)
                return super().chat(request)

        _wire(monkeypatch, session, _RecordingChat())

        run_dataset_generation(dataset.id)

        assert requests
        for request in requests:
            response_format = (request.parameters or {}).get("response_format")
            assert isinstance(response_format, dict)
            assert response_format["type"] == "json_schema"
        names = {
            request.parameters["response_format"]["json_schema"]["name"]
            for request in requests
        }
        assert names == {"eval_question_candidates", "eval_question_scores"}

    def test_persistent_provider_failure_lands_failed(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Three consecutive provider errors fail the dataset with the reason."""
        user = _user(session)
        collection = _collection_with_documents(session, user)
        connection = _connection(session, user)
        dataset = create_generation_dataset(
            session, user, _payload(collection, connection)
        )

        class _DeadChat(_ScriptedChat):
            def chat(self, request: ChatRequest) -> dict[str, object]:
                raise RuntimeError("provider unreachable")

        _wire(monkeypatch, session, _DeadChat())

        run_dataset_generation(dataset.id)

        with Session(session.get_bind()) as fresh:
            stored = fresh.get(models.EvalDataset, dataset.id)
            assert stored is not None
            assert stored.status == EvalDatasetStatus.FAILED.value
            assert stored.error_message is not None
            assert "unreachable" in stored.error_message

    def test_all_rejected_candidates_lands_failed(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A model whose quotes never match produces a FAILED row, not junk."""
        user = _user(session)
        collection = _collection_with_documents(session, user)
        connection = _connection(session, user)
        dataset = create_generation_dataset(
            session, user, _payload(collection, connection)
        )

        class _UngroundedChat(_ScriptedChat):
            def chat(self, request: ChatRequest) -> dict[str, object]:
                items = [
                    {
                        "question": "Fabricated?",
                        "answer": "x",
                        "quote": "this text exists nowhere in the corpus at all",
                    }
                ]
                return {"content": json.dumps(items)}

        _wire(monkeypatch, session, _UngroundedChat())

        run_dataset_generation(dataset.id)

        with Session(session.get_bind()) as fresh:
            stored = fresh.get(models.EvalDataset, dataset.id)
            assert stored is not None
            assert stored.status == EvalDatasetStatus.FAILED.value
            assert stored.error_message is not None
            assert "quality filters" in stored.error_message

    def test_deleting_the_dataset_cancels_generation(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Row deletion mid-run stops the loop without errors or resurrection."""
        user = _user(session)
        collection = _collection_with_documents(session, user)
        connection = _connection(session, user)
        dataset = create_generation_dataset(
            session, user, _payload(collection, connection)
        )

        class _DeletingChat(_ScriptedChat):
            """Deletes the dataset row from a second session on the first call."""

            def chat(self, request: ChatRequest) -> dict[str, object]:
                if self.calls == 0:
                    with Session(session.get_bind()) as killer:
                        row = killer.get(models.EvalDataset, dataset.id)
                        assert row is not None
                        killer.delete(row)
                        killer.commit()
                return super().chat(request)

        _wire(monkeypatch, session, _DeletingChat())

        run_dataset_generation(dataset.id)

        with Session(session.get_bind()) as fresh:
            assert fresh.get(models.EvalDataset, dataset.id) is None
            leftover = fresh.exec(
                select(models.EvalDatasetQuery).where(
                    models.EvalDatasetQuery.dataset_id == dataset.id
                )
            ).all()
            assert leftover == []


def _assert_triple_shape(fresh: Session, dataset_id, collection_id) -> None:
    """The persisted triple: metadata-carrying queries, qrels, and full corpus."""
    queries = fresh.exec(
        select(models.EvalDatasetQuery).where(
            models.EvalDatasetQuery.dataset_id == dataset_id
        )
    ).all()
    assert len(queries) == 4
    for query in queries:
        metadata = query.query_metadata or {}
        assert metadata["question_type"] in {"single_fact", "paraphrased", "multi_detail"}
        assert metadata["scores"]["groundedness"] == 5
        assert metadata["source_chunk_ids"]
    doc_ids = {
        str(doc.id)
        for doc in fresh.exec(
            select(models.Document).where(
                models.Document.collection_id == collection_id
            )
        ).all()
    }
    qrels = fresh.exec(
        select(models.EvalRelevanceJudgment).where(
            models.EvalRelevanceJudgment.dataset_id == dataset_id
        )
    ).all()
    assert len(qrels) == 4
    assert {qrel.doc_external_id for qrel in qrels} <= doc_ids
    corpus = fresh.exec(
        select(models.EvalDatasetDocument).where(
            models.EvalDatasetDocument.dataset_id == dataset_id
        )
    ).all()
    assert {doc.external_doc_id for doc in corpus} == doc_ids
    assert all("section 0" in doc.text for doc in corpus)


class _scope:
    """Context manager handing back the test session as a session_scope."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def __enter__(self) -> Session:
        return self._session

    def __exit__(self, *args: object) -> None:
        return None
