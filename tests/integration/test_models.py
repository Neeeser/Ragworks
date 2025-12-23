from __future__ import annotations

from fastapi.testclient import TestClient


def test_model_catalog_listing(client: TestClient, user_context: dict[str, object]) -> None:
    response = client.get("/api/models", headers=user_context["headers"])
    assert response.status_code == 200, response.text
    models = response.json()
    assert isinstance(models, list) and models, "expected at least one model from OpenRouter"
    assert {"id", "name"}.issubset(models[0])
