"""HTTP-contract tests for the collection insights routes."""

from __future__ import annotations

from uuid import uuid4

import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.visualization.insights import engine
from app.visualization.insights.service import InsightService
from tests.visualization.conftest import add_document


@pytest.fixture(autouse=True)
def _stub_projection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        engine,
        "fit_projection",
        lambda matrix, random_state=42: (
            b"planar-reducer",
            np.asarray(matrix[:, :2], dtype=np.float64),
        ),
    )
    monkeypatch.setattr(
        engine,
        "transform_points",
        lambda reducer_blob, basis, new: np.asarray(new[:, :2], dtype=np.float64),
    )


def _make_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Insights", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _build_ready_snapshot(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    add_document(
        session,
        collection,
        user,
        "one.txt",
        [("refund policy thirty days", [1.0, 0.0]), ("shipping five days", [0.9, 0.1])],
    )
    add_document(
        session,
        collection,
        user,
        "two.txt",
        [("refund policy thirty days", [1.0, 0.0])],
    )
    service = InsightService(session)
    marker = service.begin_refresh(collection.id, user.id)
    assert marker is not None
    service.run_refresh(marker)


def test_overview_is_empty_but_honest_for_a_fresh_collection(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _make_collection(session, auth_user)
    response = client.get(f"/api/collections/{collection.id}/insights")
    assert response.status_code == 200
    body = response.json()
    assert body["snapshot"] is None
    assert body["active"] is None
    assert body["chunk_total"] == 0
    assert body["can_compute"] is False


def test_map_returns_404_before_any_snapshot_exists(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _make_collection(session, auth_user)
    response = client.get(f"/api/collections/{collection.id}/insights/map")
    assert response.status_code == 404


def test_map_serves_points_documents_and_snapshot_metadata(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _make_collection(session, auth_user)
    _build_ready_snapshot(session, collection, auth_user)

    response = client.get(f"/api/collections/{collection.id}/insights/map")
    assert response.status_code == 200
    body = response.json()
    assert body["snapshot"]["status"] == "ready"
    assert body["snapshot"]["space"] == "semantic"
    assert len(body["points"]) == 3
    assert {point["document_name"] for point in body["points"]} == {
        "one.txt",
        "two.txt",
    }
    assert len(body["documents"]) == 2
    point = body["points"][0]
    assert set(point) >= {"chunk_id", "document_id", "x", "y", "cluster_index"}


def test_graph_serves_document_nodes_and_edges(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _make_collection(session, auth_user)
    _build_ready_snapshot(session, collection, auth_user)

    response = client.get(f"/api/collections/{collection.id}/insights/graph")
    assert response.status_code == 200
    body = response.json()
    assert len(body["documents"]) == 2
    assert body["edges"], "near-identical documents must be linked"
    edge = body["edges"][0]
    assert edge["similarity"] > 0.5
    assert edge["collision_count"] >= 1


def test_overlaps_reports_the_cross_document_pair(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    collection = _make_collection(session, auth_user)
    _build_ready_snapshot(session, collection, auth_user)

    response = client.get(f"/api/collections/{collection.id}/insights/overlaps")
    assert response.status_code == 200
    body = response.json()
    assert body["pairs"]
    top = body["pairs"][0]
    assert top["similarity"] == pytest.approx(1.0, abs=1e-5)
    assert {top["a"]["document_name"], top["b"]["document_name"]} == {
        "one.txt",
        "two.txt",
    }
    assert "refund" in top["a"]["text_snippet"]


def test_refresh_schedules_through_the_task_seam(
    client: TestClient,
    session: Session,
    auth_user: models.User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = _make_collection(session, auth_user)
    calls: list[tuple[object, object]] = []
    monkeypatch.setattr(
        "app.api.routes.insights.schedule_insight_refresh",
        lambda collection_id, user_id: calls.append((collection_id, user_id)) or True,
    )
    response = client.post(f"/api/collections/{collection.id}/insights/refresh")
    assert response.status_code == 200
    assert calls == [(collection.id, auth_user.id)]


def test_probe_projects_a_query_into_a_lexical_space(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """A BM25-only collection probes locally — no provider, no embedder."""
    collection = _make_collection(session, auth_user)
    add_document(
        session,
        collection,
        user=auth_user,
        name="lex.txt",
        chunks=[
            ("postgres vacuum autovacuum tuning", []),
            ("espresso grinder burr alignment", []),
            ("postgres index bloat monitoring", []),
            ("coffee roast development curves", []),
        ],
    )
    service = InsightService(session)
    marker = service.begin_refresh(collection.id, auth_user.id)
    assert marker is not None
    service.run_refresh(marker)

    response = client.post(
        f"/api/collections/{collection.id}/insights/probe",
        json={"query": "postgres index maintenance"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["space"] == "lexical"
    assert body["matches"]
    assert "postgres" in body["matches"][0]["text_snippet"]


def test_cross_user_collection_is_invisible(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    other = models.User(
        email="other-insights@example.com", full_name="Other", hashed_password="x"
    )
    session.add(other)
    session.commit()
    session.refresh(other)
    collection = _make_collection(session, other)
    for path in ("insights", "insights/map", "insights/graph", "insights/overlaps"):
        assert client.get(f"/api/collections/{collection.id}/{path}").status_code == 404
    assert (
        client.post(f"/api/collections/{collection.id}/insights/refresh").status_code
        == 404
    )


def test_unknown_collection_404s(client: TestClient) -> None:
    assert client.get(f"/api/collections/{uuid4()}/insights").status_code == 404
