from __future__ import annotations

from fastapi.testclient import TestClient


def test_collection_query_returns_ranked_chunks(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
    ingested_documents: list[dict[str, object]],
) -> None:
    response = client.post(
        f"/api/collections/{primary_collection['id']}/query",
        headers=user_context["headers"],
        json={"query": "What is TransparentRAG?", "top_k": 3},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["chunks"], "retrieval returned zero chunks"
    assert all("score" in chunk for chunk in payload["chunks"])
