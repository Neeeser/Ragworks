"""Thin-route tests for the collections module.

Creation/update/prompt behavior lives in ``tests/services/test_collections.py``
and the deletion cascade in ``tests/services/test_collection_deletion.py``; the
cross-cutting 401/404/422 contract lives in ``tests/api/test_route_contract.py``.
What remains here is the route+repository integration that isn't a pure service
concern: the 404 guard and the stats aggregation shaped for the wire. Activity history
lives in ``tests/services/test_collection_history.py``.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes import collections as collections_routes
from app.db import models
from app.db.repositories import CollectionRepository, UserRepository
from app.services.collection_history import BUCKET_LADDER


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="user@example.com",
        full_name="User",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    CollectionRepository(session).add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_get_collection_and_prompt_missing_return_404(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.get_collection(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404

    with pytest.raises(HTTPException) as excinfo:
        collections_routes.get_collection_prompt(uuid4(), current_user=user, session=session)
    assert excinfo.value.status_code == 404


def test_get_collection_returns_schema(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    fetched = collections_routes.get_collection(collection.id, current_user=user, session=session)

    assert fetched.id == collection.id
    assert fetched.metadata == {}


def test_collection_stats_include_query_latency(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)

    session.add_all(
        [
            models.Document(
                collection_id=collection.id,
                user_id=user.id,
                name=f"doc-{suffix}.txt",
                content_type="text/plain",
                status=models.DocumentStatus.READY,
                num_chunks=chunks,
                num_tokens=tokens,
                chunk_size=128,
                chunk_overlap=8,
                chunk_strategy=models.ChunkStrategy.TOKEN,
                embedding_model="embed-model",
            )
            for suffix, chunks, tokens in (("a", 3, 120), ("b", 5, 240))
        ]
    )
    session.add_all(
        [
            models.QueryEvent(
                user_id=user.id,
                collection_id=collection.id,
                query_text=text,
                top_k=3,
                model="embed-model",
                context_tokens=12,
                latency_ms=latency,
                response_payload={"match_count": 3},
            )
            for text, latency in (("query a", 120.0), ("query b", 180.0))
        ]
    )
    session.commit()

    stats = collections_routes.get_collection_stats(
        collection.id, current_user=user, session=session
    )
    assert stats.document_count == 2
    assert stats.chunk_count == 8
    assert stats.average_latency_ms == pytest.approx(150.0, rel=1e-3)
    assert stats.last_used_at is not None

    stats_list = collections_routes.list_collection_stats(current_user=user, session=session)
    stats_map = {entry.collection_id: entry for entry in stats_list}
    assert stats_map[collection.id].chunk_count == 8



def test_stats_history_rejects_an_inverted_span(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """An end before its start is a 400, not a silently empty chart."""
    collection = _create_collection(session, auth_user)

    response = client.get(
        f"/api/collections/{collection.id}/stats/history",
        params={"start": "2026-07-25T12:00:00Z", "end": "2026-07-25T11:00:00Z"},
    )

    assert response.status_code == 400


def test_stats_history_serves_a_resolved_lifetime_domain(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """With no span the response carries the domain and bucket width it chose."""
    collection = _create_collection(session, auth_user)

    body = client.get(f"/api/collections/{collection.id}/stats/history").json()

    assert body["bucket_seconds"] in BUCKET_LADDER
    assert body["start"] < body["end"]
    assert body["points"], "an idle collection still renders an axis"


def test_collection_indexes_reports_the_indexes_its_graph_names(client) -> None:
    """A collection can always answer where its data lives.

    The ordinary pipeline names its own index, so there is no slot to fill
    and nothing to choose here — but the page still has to say which store
    the corpus is in, which is what `targets` carries.
    """
    created = client.post("/api/collections", json={"name": "Indexes"}).json()

    read = client.get(f"/api/collections/{created['id']}/indexes")

    assert read.status_code == 200
    body = read.json()
    targets = {target["name"]: target for target in body["targets"]}
    assert targets
    dense = [target for target in targets.values() if target["vector_type"] == "dense"]
    assert dense
    assert dense[0]["pipelines"]
