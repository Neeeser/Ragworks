from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.providers.base import CatalogResult
from app.providers.openrouter import OpenRouterAdapter
from app.schemas.providers import CatalogMetadata, CatalogModel


def test_catalog_route_forwards_refresh_and_serializes_metadata(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: list[bool] = []

    def _list(self, kind, force_refresh=False):
        seen.append(force_refresh)
        return CatalogResult(
            models=[
                CatalogModel(
                    connection_id=self.connection.id,
                    connection_label=self.connection.label,
                    provider_type=self.provider_type,
                    id="chat/model",
                    name="Chat model",
                )
            ],
            meta=CatalogMetadata(
                freshness="stale", age_seconds=8, refreshing=True
            ),
        )

    monkeypatch.setattr(OpenRouterAdapter, "list_models", _list)

    response = client.get("/api/models?kind=chat&refresh=true")

    assert response.status_code == 200
    assert seen == [True]
    assert response.json()["meta"] == {
        "freshness": "stale",
        "age_seconds": 8.0,
        "refreshing": True,
        "warning": None,
    }


def test_dimension_route_is_connection_qualified(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection = client.get("/api/connections").json()[0]
    model_id = f"embedding/{uuid4()}"
    monkeypatch.setattr(
        OpenRouterAdapter, "embedding_dimension", lambda self, model: 1536
    )

    response = client.get(
        f"/api/connections/{connection['id']}/models/embedding-dimension",
        params={"model_id": model_id},
    )

    assert response.status_code == 200
    assert response.json() == {
        "connection_id": connection["id"],
        "model_id": model_id,
        "dimension": 1536,
    }
