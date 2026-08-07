"""Whether a collection can be searched with an image, over the wire.

A user attaching an image to a search on a text-only collection used to
learn about it from a node-level complaint mid-run. Two contracts replace
that: `GET /query-arguments` states up front whether the pipeline reads
images, and the query endpoints refuse media a pipeline cannot process
with a 400 that says so.
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ASSETS = Path(__file__).parent.parent / "assets"


def _create_collection(client: TestClient) -> str:
    response = client.post("/api/collections", json={"name": "Media Query", "description": ""})
    assert response.status_code in (200, 201)
    return str(response.json()["id"])


def _png_base64() -> str:
    return base64.b64encode((ASSETS / "diagram.png").read_bytes()).decode("ascii")


def _catalog_publishing(*modalities: str) -> type:
    """A `ProviderResolver` stand-in whose catalog publishes `modalities`."""

    class _Catalog:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def input_modalities(self, *_args: object) -> frozenset[str]:
            return frozenset(modalities)

    return _Catalog


@pytest.mark.parametrize(
    ("published", "accepts"),
    [
        (("text", "image"), True),
        (("text",), False),
        ((), False),
    ],
    ids=[
        "an image-capable embedding model",
        "a text-only embedding model",
        "a catalog publishing no modalities",
    ],
)
def test_query_arguments_report_whether_the_pipeline_reads_images(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, published: tuple[str, ...], accepts: bool
) -> None:
    monkeypatch.setattr(
        "app.services.retrieval.ProviderResolver", _catalog_publishing(*published)
    )
    collection_id = _create_collection(client)

    response = client.get(f"/api/collections/{collection_id}/query-arguments")

    assert response.status_code == 200
    assert response.json()["accepts_query_media"] is accepts


def test_an_image_query_on_a_text_only_pipeline_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The refusal names the pipeline, not the node that would have failed."""
    monkeypatch.setattr(
        "app.services.tool_invocation.ProviderResolver", _catalog_publishing("text")
    )
    collection_id = _create_collection(client)

    response = client.post(
        f"/api/collections/{collection_id}/query",
        json={"query": "", "query_media": {"media_type": "image/png", "data": _png_base64()}},
    )

    assert response.status_code == 400
    assert "cannot read image queries" in response.json()["detail"]


def test_an_unpublished_modality_list_is_refused_rather_than_run(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The embedder does not widen on silence, so neither does the refusal.

    Letting the query through here reaches the dense retriever with an item
    the embedder declined to embed, and the run dies naming neither the image
    nor the pipeline.
    """
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _catalog_publishing())
    collection_id = _create_collection(client)

    response = client.post(
        f"/api/collections/{collection_id}/query",
        json={"query": "", "query_media": {"media_type": "image/png", "data": _png_base64()}},
    )

    assert response.status_code == 400
    assert "cannot read image queries" in response.json()["detail"]


def test_the_tool_invoke_surface_refuses_it_too(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The search composer posts here whenever the collection has a binding."""
    monkeypatch.setattr(
        "app.services.tool_invocation.ProviderResolver", _catalog_publishing("text")
    )
    collection_id = _create_collection(client)
    binding_id = client.get(f"/api/collections/{collection_id}/tools").json()["tools"][0]["id"]

    response = client.post(
        f"/api/collections/{collection_id}/tools/{binding_id}/invoke",
        json={"query": "", "query_media": {"media_type": "image/png", "data": _png_base64()}},
    )

    assert response.status_code == 400
    assert "cannot read image queries" in response.json()["detail"]
