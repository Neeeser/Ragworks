"""Vector-store reads land in the usage ledger with what Pinecone reported.

The SDK is stubbed at the client boundary with the envelopes the API docs
document (`docs/external-api/pinecone/reference/api/2026-04/data-plane/`),
and every row is read back through a fresh session. The cases that matter
are the ones where nothing may be written: no scope open, a response with no
usage block, and pgvector — which costs nothing and therefore reports
nothing.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from app.db import models
from app.providers import usage_capture
from app.providers.usage_context import usage_scope
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.auth import UserCreate
from app.schemas.enums import IndexBackend, UsageKind, UsageSurface, UsageUnit
from app.services.accounts import AccountService
from app.vectorstores.base import IndexSpec
from app.vectorstores.pinecone import PineconeStore
from app.vectorstores.pinecone.usage import PineconeUsageLedger
from app.vectorstores.registry import get_vector_store
from tests.utils.providers import add_pinecone_connection
from tests.utils.vectors import pgvector_store

CONNECTION_ID = UUID("22222222-2222-2222-2222-222222222222")
INDEX = "unit-index"


@pytest.fixture
def user(session: Session) -> models.User:
    """A registered account the ledger rows are attributed to."""
    return AccountService(session).register(
        UserCreate(email=f"store-usage-{uuid4().hex}@example.com", password="password123")
    )


def ledger_rows(session: Session, user_id: UUID) -> list[models.UsageEvent]:
    """Every ledger row for one user, read back through a fresh session."""
    with Session(session.get_bind()) as fresh:
        statement = select(models.UsageEvent).where(models.UsageEvent.user_id == user_id)
        return list(fresh.exec(statement).all())


def ledger_count(session: Session) -> int:
    """Every ledger row in the database, whoever it names.

    A no-record assertion scoped to one user would still pass if the writer
    attributed the row to some other owner.
    """
    with Session(session.get_bind()) as fresh:
        return len(list(fresh.exec(select(models.UsageEvent)).all()))


class _StubIndex:
    """A data-plane index handle answering the documented read envelopes."""

    def __init__(
        self,
        *,
        query_usage: object | None = None,
        search_usage: object | None = None,
        fetch_usage: object | None = None,
    ) -> None:
        self._query_usage = query_usage
        self._search_usage = search_usage
        self._fetch_usage = fetch_usage

    def query(self, **_kwargs: Any) -> SimpleNamespace:
        response = SimpleNamespace(matches=[])
        if self._query_usage is not None:
            response.usage = self._query_usage
        return response

    def search(self, **_kwargs: Any) -> SimpleNamespace:
        response = SimpleNamespace(result=SimpleNamespace(hits=[]))
        if self._search_usage is not None:
            response.usage = self._search_usage
        return response

    def list(self, **_kwargs: Any) -> Any:
        return iter([["doc-1:0"], ["doc-1:1"]])

    def fetch(self, *, ids: list[str], namespace: str | None = None) -> SimpleNamespace:
        response = SimpleNamespace(vectors={})
        if self._fetch_usage is not None:
            response.usage = self._fetch_usage
        return response


class _StubPinecone:
    """The SDK surface `PineconeStore` reaches for on the read paths."""

    def __init__(self, index: _StubIndex) -> None:
        self._index = index

    # Capitalized to mirror the SDK's own handle accessor.
    def Index(self, _name: str) -> _StubIndex:
        return self._index


def _store(index: _StubIndex, connection_id: UUID = CONNECTION_ID) -> PineconeStore:
    """A Pinecone store whose reads ledger against a connection."""
    return PineconeStore(_StubPinecone(index), PineconeUsageLedger(connection_id))  # type: ignore[arg-type]


def test_query_records_the_read_units_the_response_reported(
    session: Session, user: models.User
) -> None:
    # The dense-query envelope: `{"matches": [...], "usage": {"read_units": 6}}`.
    store = _store(_StubIndex(query_usage=SimpleNamespace(read_units=6)))

    with usage_scope(user.id, UsageSurface.CHAT, context_type="collection"):
        store.query(INDEX, "ns-1", embedding=[0.1, 0.2], top_k=5)

    rows = ledger_rows(session, user.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.kind == UsageKind.VECTOR_STORE_READ.value
    assert row.unit == UsageUnit.READ_UNITS.value
    assert row.quantity == 6
    assert row.provider == "pinecone"
    # The index is the resource the units bill against.
    assert row.model == INDEX
    assert row.connection_id == CONNECTION_ID
    assert row.surface == UsageSurface.CHAT.value
    assert row.context_type == "collection"
    # Pinecone publishes no read-unit price.
    assert row.cost_usd is None


def test_query_reads_the_camel_case_spelling_too(session: Session, user: models.User) -> None:
    # The /query OpenAPI schema names the counter `readUnits`.
    store = _store(_StubIndex(query_usage={"readUnits": 3}))

    with usage_scope(user.id, UsageSurface.CHAT):
        store.query(INDEX, "ns-1", embedding=[0.1], top_k=1)

    assert [row.quantity for row in ledger_rows(session, user.id)] == [3]


def test_lexical_search_records_read_units_and_the_integrated_embed_tokens(
    session: Session, user: models.User
) -> None:
    # The records-search envelope reports both counters.
    store = _store(
        _StubIndex(search_usage={"read_units": 5, "embed_total_tokens": 8, "rerank_units": 1})
    )

    with usage_scope(user.id, UsageSurface.INGESTION):
        store.lexical_query(INDEX, "ns-1", text="hello", top_k=3)

    rows = {row.kind: row for row in ledger_rows(session, user.id)}
    assert set(rows) == {UsageKind.VECTOR_STORE_READ.value, UsageKind.EMBEDDING.value}
    read = rows[UsageKind.VECTOR_STORE_READ.value]
    assert (read.quantity, read.unit, read.model) == (5, UsageUnit.READ_UNITS.value, INDEX)
    embed = rows[UsageKind.EMBEDDING.value]
    assert embed.quantity == 8
    assert embed.unit == UsageUnit.TOKENS.value
    assert embed.prompt_tokens == 8
    # The tokens were spent by the index's integrated sparse model.
    assert embed.model == "pinecone-sparse-english-v0"


def test_fetch_records_one_row_per_billed_request(session: Session, user: models.User) -> None:
    store = _store(_StubIndex(fetch_usage={"readUnits": 1}))

    with usage_scope(user.id, UsageSurface.CHAT):
        store.fetch_document_chunks(INDEX, "ns-1", "doc-1", limit=10)

    assert [row.quantity for row in ledger_rows(session, user.id)] == [1]


def test_response_without_a_usage_block_records_nothing(
    session: Session, user: models.User
) -> None:
    store = _store(_StubIndex())

    with usage_scope(user.id, UsageSurface.CHAT):
        store.query(INDEX, "ns-1", embedding=[0.1], top_k=1)
        store.lexical_query(INDEX, "ns-1", text="hello", top_k=1)

    assert ledger_count(session) == 0


def test_no_open_scope_records_nothing(session: Session, user: models.User) -> None:
    store = _store(_StubIndex(query_usage={"read_units": 6}))

    store.query(INDEX, "ns-1", embedding=[0.1], top_k=1)

    assert ledger_count(session) == 0


def test_a_store_built_outside_a_connection_records_nothing(
    session: Session, user: models.User
) -> None:
    store = PineconeStore(_StubPinecone(_StubIndex(query_usage={"read_units": 6})))  # type: ignore[arg-type]

    with usage_scope(user.id, UsageSurface.CHAT):
        store.query(INDEX, "ns-1", embedding=[0.1], top_k=1)

    assert ledger_count(session) == 0


def test_a_failed_ledger_write_does_not_fail_the_read(
    session: Session, user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _broken_session_scope() -> Any:
        raise RuntimeError("ledger unavailable")

    monkeypatch.setattr(usage_capture, "session_scope", _broken_session_scope)
    store = _store(_StubIndex(query_usage={"read_units": 6}))

    with usage_scope(user.id, UsageSurface.CHAT):
        response = store.query(INDEX, "ns-1", embedding=[0.1], top_k=1)

    assert response.matches == []
    assert ledger_count(session) == 0


def test_the_registry_binds_reads_to_the_users_pinecone_connection(
    session: Session, user: models.User, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection = add_pinecone_connection(session, user, api_key="pk-123")
    index = _StubIndex(query_usage={"read_units": 2})
    monkeypatch.setattr(
        "app.vectorstores.registry.get_pinecone_client",
        lambda _api_key: _StubPinecone(index),
    )

    store = get_vector_store(IndexBackend.PINECONE, user=user, session=session)
    with usage_scope(user.id, UsageSurface.CHAT):
        store.query(INDEX, "ns-1", embedding=[0.1], top_k=1)

    assert [row.connection_id for row in ledger_rows(session, user.id)] == [connection.id]


def test_pgvector_reads_record_nothing(pgvector_session: Session, user: models.User) -> None:
    """pgvector costs nothing per read, so it reports nothing to the ledger."""
    store = pgvector_store(pgvector_session)
    store.create_index(IndexSpec(name="usagedocs", dimension=3, metric="cosine"))
    chunk = DocumentChunk(
        document_id="doc-1",
        chunk_id="a",
        text="apple",
        order=0,
        metadata=DocumentMetadata(data={}),
        embedding=[1.0, 0.0, 0.0],
    )

    with usage_scope(user.id, UsageSurface.CHAT):
        store.upsert("usagedocs", "ns-1", [chunk])
        store.query("usagedocs", "ns-1", embedding=[1.0, 0.0, 0.0], top_k=1)

    assert ledger_count(pgvector_session) == 0
