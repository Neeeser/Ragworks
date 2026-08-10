"""The usage ledger records what each provider call actually reported.

Every test here drives a real proxy against a stub provider and reads the
row back through a fresh session, so deleting a capture point fails a test.
The cases that matter are the ones where nothing may be written: no scope
open, and an envelope carrying no usage — a row invented in either case
would silently overstate every total built over the ledger.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any
from uuid import UUID, uuid4

import anyio
import pytest
from sqlmodel import Session, select
from starlette.concurrency import iterate_in_threadpool

from app.db import models
from app.providers.chat.base import ChatRequest, ParsedChatResponse, ParsedStreamChunk
from app.providers.throttled import ThrottledEmbedder, ThrottledReranker
from app.providers.usage_capture import UsageCapturingChatProvider, UsageReporter
from app.providers.usage_context import iterate_in_usage_scope, usage_scope
from app.schemas.auth import UserCreate
from app.schemas.enums import UsageKind, UsageSurface, UsageUnit
from app.schemas.models import ModelPricing
from app.schemas.usage import MeasuredUsage
from app.services.accounts import AccountService

CONNECTION_ID = UUID("11111111-1111-1111-1111-111111111111")


@pytest.fixture
def user(session: Session) -> models.User:
    """A registered account the ledger rows are attributed to."""
    return AccountService(session).register(
        UserCreate(email=f"ledger-{uuid4().hex}@example.com", password="password123")
    )


def ledger_rows(session: Session, user_id: UUID) -> list[models.UsageEvent]:
    """Every ledger row for one user, read back through a fresh session."""
    with Session(session.get_bind()) as fresh:
        statement = select(models.UsageEvent).where(models.UsageEvent.user_id == user_id)
        return list(fresh.exec(statement).all())


def ledger_count(session: Session) -> int:
    """Every ledger row in the database, whoever it names.

    A no-record assertion scoped to one user would still pass if the writer
    attributed the row to some other owner, which is exactly the bug the
    scope check prevents.
    """
    with Session(session.get_bind()) as fresh:
        return len(list(fresh.exec(select(models.UsageEvent)).all()))


def reporter(kind: UsageKind, model: str, pricing: ModelPricing | None = None) -> UsageReporter:
    """A reporter bound to a fixed provider, model, and (optional) price."""
    return UsageReporter(
        kind=kind,
        provider="openrouter",
        model=model,
        connection_id=CONNECTION_ID,
        pricing_lookup=lambda: pricing,
    )


class _Embedder:
    """An embedder reporting whatever counters the test hands it."""

    def __init__(self, counters: dict[str, int] | None) -> None:
        self.model_name = "embed-1"
        self._counters = counters

    @property
    def usage(self) -> dict[str, int] | None:
        return self._counters

    def embed_documents(self, chunks: Sequence[Any]) -> Sequence[list[float]]:
        return [[0.1, 0.2] for _ in chunks]

    def embed_images(self, images: Sequence[Any]) -> Sequence[list[float]]:
        return [[0.1, 0.2] for _ in images]

    def embed_query(self, query: str) -> list[float]:
        return [0.1, 0.2]


class _Reranker:
    """A reranker reporting the measurement the test hands it."""

    def __init__(self, usage: MeasuredUsage | None) -> None:
        self.model_name = "rerank-1"
        self.usage = usage

    def rerank(self, query: str, candidates: Sequence[Any]) -> Sequence[Any]:
        return []


def throttled_embedder(counters: dict[str, int] | None, **kwargs: Any) -> ThrottledEmbedder:
    """A throttled embedder wired to the ledger, with no real pacing."""
    return ThrottledEmbedder(
        _Embedder(counters),
        CONNECTION_ID,
        limit=2,
        rpm=None,
        reporter=reporter(UsageKind.EMBEDDING, "embed-1", **kwargs),
    )


@pytest.fixture
def scope(user: models.User) -> Iterator[None]:
    """An ingestion scope, the shape a background ingestion run opens."""
    document_id = uuid4()
    with usage_scope(
        user.id,
        UsageSurface.INGESTION,
        context_type="pipeline_run",
        context_id=document_id,
    ):
        yield


def test_embedding_call_records_its_reported_tokens(
    session: Session, user: models.User, scope: None
) -> None:
    """An embedding call inside a scope lands one row carrying its dimensions."""
    throttled_embedder({"prompt_tokens": 120, "total_tokens": 120}).embed_documents([object()])

    rows = ledger_rows(session, user.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.kind == UsageKind.EMBEDDING.value
    assert row.surface == UsageSurface.INGESTION.value
    assert row.provider == "openrouter"
    assert row.model == "embed-1"
    assert row.connection_id == CONNECTION_ID
    assert row.context_type == "pipeline_run"
    assert (row.quantity, row.unit) == (120, UsageUnit.TOKENS.value)
    assert row.prompt_tokens == 120
    assert row.cost_usd is None


def test_no_scope_records_nothing(session: Session, user: models.User) -> None:
    """A call nobody claimed is not attributed to a guessed owner."""
    before = ledger_count(session)

    throttled_embedder({"prompt_tokens": 120}).embed_query("hello")

    assert ledger_count(session) == before


def test_an_envelope_with_no_usage_records_nothing(
    session: Session, user: models.User, scope: None
) -> None:
    """A provider reporting nothing leaves no row, never a zero-token one."""
    before = ledger_count(session)

    throttled_embedder(None).embed_query("hello")

    assert ledger_count(session) == before


def test_published_prices_are_stamped_at_call_time(
    session: Session, user: models.User, scope: None
) -> None:
    """Tokens times the catalog's per-token price, stamped on the row."""
    pricing = ModelPricing(prompt="0.0001", completion="0.0002")
    embedder = throttled_embedder({"prompt_tokens": 1000}, pricing=pricing)

    embedder.embed_query("hello")

    rows = ledger_rows(session, user.id)
    assert rows[0].cost_usd == pytest.approx(0.1)


def test_a_failed_ledger_write_never_fails_the_call(
    session: Session, user: models.User, scope: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Recording is measurement: a broken ledger must not break the work."""

    def _explode() -> Any:
        raise RuntimeError("ledger is down")

    monkeypatch.setattr("app.providers.usage_capture.session_scope", _explode)

    vectors = throttled_embedder({"prompt_tokens": 10}).embed_documents([object()])

    assert len(vectors) == 1
    assert ledger_rows(session, user.id) == []


def test_rerank_records_the_unit_its_provider_bills_in(
    session: Session, user: models.User, scope: None
) -> None:
    """Cohere bills search units; the row states units, not invented tokens."""
    inner = _Reranker(MeasuredUsage(quantity=1, unit=UsageUnit.SEARCH_UNITS))
    throttled = ThrottledReranker(
        inner,
        CONNECTION_ID,
        limit=2,
        rpm=None,
        reporter=reporter(UsageKind.RERANK, "rerank-1"),
    )

    throttled.rerank("q", [])

    rows = ledger_rows(session, user.id)
    assert [(row.kind, row.quantity, row.unit, row.cost_usd) for row in rows] == [
        (UsageKind.RERANK.value, 1, UsageUnit.SEARCH_UNITS.value, None)
    ]


def test_a_reranker_reporting_nothing_records_nothing(
    session: Session, user: models.User, scope: None
) -> None:
    """TEI reports no usage, so its calls leave the ledger untouched."""
    throttled = ThrottledReranker(
        _Reranker(None),
        CONNECTION_ID,
        limit=2,
        rpm=None,
        reporter=reporter(UsageKind.RERANK, "rerank-1"),
    )

    throttled.rerank("q", [])

    assert ledger_rows(session, user.id) == []


class _ChatProvider:
    """A chat provider answering with the usage payload the test hands it."""

    name = "openrouter"

    def __init__(self, usage: dict[str, Any] | None) -> None:
        self._usage = usage

    def get_model(self, model_id: str) -> None:
        return None

    def chat(self, request: Any) -> dict[str, Any]:
        return {"choices": [{"message": {"content": "hi"}}], "usage": self._usage}

    def chat_stream(self, request: Any) -> Iterator[dict[str, Any]]:
        yield {"choices": [{"delta": {"content": "hi"}}]}
        yield {"choices": [], "usage": self._usage}

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        return ParsedChatResponse(
            message={"content": "hi"},
            usage=response.get("usage") or {},
            provider=self.name,
            response_model="chat-1",
        )

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        return ParsedStreamChunk(
            provider=self.name,
            response_model="chat-1",
            finish_reason=None,
            delta_content=None,
            tool_calls=None,
            reasoning=None,
            usage=chunk.get("usage"),
        )


def capturing_chat(usage: dict[str, Any] | None) -> UsageCapturingChatProvider:
    """A capturing chat proxy over a stub reporting `usage`."""
    return UsageCapturingChatProvider(
        _ChatProvider(usage),
        lambda model: reporter(UsageKind.CHAT, model),
    )


def chat_request() -> ChatRequest:
    """One minimal provider-neutral chat request."""
    return ChatRequest(
        messages=[{"role": "user", "content": "hi"}], tools=None, model="chat-1", parameters=None
    )


def test_a_buffered_chat_call_records_both_token_sides(session: Session, user: models.User) -> None:
    """The surface comes from the scope; the tokens from the parsed response."""
    with usage_scope(user.id, UsageSurface.STUDIO):
        capturing_chat({"prompt_tokens": 30, "completion_tokens": 12, "total_tokens": 42}).chat(
            chat_request()
        )

    rows = ledger_rows(session, user.id)
    assert [
        (r.kind, r.surface, r.quantity, r.prompt_tokens, r.completion_tokens) for r in rows
    ] == [(UsageKind.CHAT.value, UsageSurface.STUDIO.value, 42, 30, 12)]


def test_a_streamed_chat_turn_records_the_usage_its_chunks_carried(
    session: Session, user: models.User
) -> None:
    """Streaming reports usage in the final chunks, and the ledger sees it."""
    with usage_scope(user.id, UsageSurface.CHAT):
        list(
            capturing_chat({"prompt_tokens": 5, "completion_tokens": 5}).chat_stream(chat_request())
        )

    rows = ledger_rows(session, user.id)
    assert [(r.surface, r.quantity) for r in rows] == [(UsageSurface.CHAT.value, 10)]


def test_a_provider_reported_cost_wins_over_the_catalog(
    session: Session, user: models.User
) -> None:
    """OpenRouter states its own cost; an invented catalog figure would disagree."""
    with usage_scope(user.id, UsageSurface.CHAT):
        capturing_chat({"prompt_tokens": 5, "cost": 0.25}).chat(chat_request())

    assert [row.cost_usd for row in ledger_rows(session, user.id)] == [0.25]


def test_a_nested_scope_keeps_the_surface_its_caller_opened(
    session: Session, user: models.User
) -> None:
    """A retrieval run under a chat turn is chat spend, not ingestion spend."""
    with usage_scope(user.id, UsageSurface.CHAT):
        with usage_scope(user.id, UsageSurface.INGESTION, context_type="pipeline_run"):
            capturing_chat({"total_tokens": 7}).chat(chat_request())

    rows = ledger_rows(session, user.id)
    assert [(r.surface, r.context_type) for r in rows] == [
        (UsageSurface.CHAT.value, "pipeline_run")
    ]


def test_a_threadpool_driven_stream_keeps_its_scope(
    session: Session, user: models.User
) -> None:
    """Starlette drives a sync SSE generator through a per-step context copy.

    A `with usage_scope(...)` inside such a generator is discarded between
    steps — the calls record nothing and the teardown reset raises
    `Token was created in a different Context`. This drives the studio's own
    iteration the way the route does.
    """

    def events() -> Iterator[str]:
        yield "before"
        capturing_chat({"total_tokens": 9}).chat(chat_request())
        yield "after"

    async def drain() -> list[str]:
        return [
            item
            async for item in iterate_in_threadpool(
                iterate_in_usage_scope(events, user.id, UsageSurface.STUDIO)
            )
        ]

    assert anyio.run(drain) == ["before", "after"]

    rows = ledger_rows(session, user.id)
    assert [(row.surface, row.quantity) for row in rows] == [(UsageSurface.STUDIO.value, 9)]


def test_a_nested_scope_for_another_user_never_inherits_the_surface(
    session: Session, user: models.User
) -> None:
    """Another user's work inside an open scope is its own spend, not this one's."""
    other = uuid4()
    with usage_scope(user.id, UsageSurface.CHAT):
        with usage_scope(other, UsageSurface.EVAL_RUN) as nested:
            assert nested.user_id == other
            assert nested.surface is UsageSurface.EVAL_RUN
