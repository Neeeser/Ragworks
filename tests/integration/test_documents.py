from __future__ import annotations

from fastapi.testclient import TestClient


def test_document_uploads_appear_in_listing(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
    ingested_documents: list[dict[str, object]],
) -> None:
    response = client.get(
        f"/api/collections/{primary_collection['id']}/documents",
        headers=user_context["headers"],
    )
    assert response.status_code == 200, response.text
    listed = response.json()
    names = [doc["name"] for doc in listed]
    for upload in ingested_documents:
        assert upload["document"]["name"] in names


def test_chunk_visualization_exposes_chunk_metadata(
    client: TestClient,
    user_context: dict[str, object],
    ingested_documents: list[dict[str, object]],
) -> None:
    target_document = ingested_documents[0]["document"]
    response = client.get(
        f"/api/documents/{target_document['id']}/chunks",
        headers=user_context["headers"],
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["chunks"], "expected stored chunks for document"
    assert all("metadata" in chunk for chunk in payload["chunks"])
