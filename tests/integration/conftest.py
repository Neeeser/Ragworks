"""Fixtures for the live integration suite (real OpenRouter + Pinecone).

Everything here is session-scoped and talks to real external services, so it
is gated behind `TEST_*` credentials. The gate itself lives in the
`_require_live_credentials` autouse fixture below rather than at import time:
that way `tests/integration/` can still be *collected* (and, more
importantly, skipped by the default `-m "not integration"` addopts) without
credentials configured — only actually *running* one of these tests raises.
"""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pinecone import Pinecone, ServerlessSpec
from pinecone.exceptions import NotFoundException

from app.api.main import app
from app.clients.openrouter import get_openrouter_client
from app.core import config as api_config
from app.pipelines.template import DEFAULT_NAMESPACE_TEMPLATE

REQUIRED_ENV_VARS = [
    "TEST_OPENROUTER_API_KEY",
    "TEST_PINECONE_API_KEY",
    "PINECONE_INDEX_NAME",
    "JWT_SECRET_KEY",
]

SETTINGS = api_config.get_settings()
ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets"
TEXT_SAMPLE = ASSETS_DIR / "sample.txt"
PDF_SAMPLE = ASSETS_DIR / "sample.pdf"

_EMBED_DIMENSION_CACHE: int | None = None


@pytest.fixture(scope="session", autouse=True)
def _require_live_credentials() -> None:
    """Fail fast, but only when an integration test actually runs.

    Deselected runs (the default `-m "not integration"` addopts) never reach
    fixture setup, so this must not fire for the unit suite.
    """
    missing = [env for env in REQUIRED_ENV_VARS if not os.getenv(env)]
    if missing:
        raise pytest.UsageError(
            "Integration tests require configured credentials. Missing: " + ", ".join(missing)
        )


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def user_credentials() -> dict[str, str]:
    return {
        "email": f"integration+{uuid4().hex[:8]}@transparentrag.io",
        "password": f"Str0ngPass!{uuid4().hex[:6]}",
        "full_name": "Integration Tester",
    }


@pytest.fixture(scope="session")
def user_context(client: TestClient, user_credentials: dict[str, str]) -> dict[str, object]:
    register_resp = client.post(
        "/api/auth/register",
        json={
            "email": user_credentials["email"],
            "password": user_credentials["password"],
            "full_name": user_credentials["full_name"],
        },
    )
    assert register_resp.status_code == 201, register_resp.text

    token_resp = client.post(
        "/api/auth/token",
        data={
            "username": user_credentials["email"],
            "password": user_credentials["password"],
            "grant_type": "password",
        },
    )
    assert token_resp.status_code == 200, token_resp.text
    token = token_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    settings_resp = client.patch(
        "/api/auth/me",
        json={
            "openrouter_api_key": os.getenv("TEST_OPENROUTER_API_KEY"),
            "pinecone_api_key": os.getenv("TEST_PINECONE_API_KEY"),
        },
        headers=headers,
    )
    assert settings_resp.status_code == 200, settings_resp.text

    me_resp = client.get("/api/auth/me", headers=headers)
    assert me_resp.status_code == 200, me_resp.text

    return {
        "headers": headers,
        "user": me_resp.json(),
        "credentials": user_credentials,
    }


class _PineconeNamespaceTracker:
    def __init__(self, index) -> None:
        self.index = index
        self.namespaces: set[str] = set()

    def register(self, namespace: str) -> None:
        self.namespaces.add(namespace)

    def cleanup(self) -> None:
        for namespace in self.namespaces:
            try:
                self.index.delete(namespace=namespace, delete_all=True)
            except Exception as exc:  # pylint: disable=broad-except
                print(f"Failed to delete Pinecone namespace {namespace}: {exc}")


def _embedding_dimension() -> int:
    global _EMBED_DIMENSION_CACHE  # pylint: disable=global-statement
    if _EMBED_DIMENSION_CACHE:
        return _EMBED_DIMENSION_CACHE
    openrouter_key = os.getenv("TEST_OPENROUTER_API_KEY", "")
    openrouter = get_openrouter_client(openrouter_key)
    response = openrouter.embed(["dimension probe"], model=SETTINGS.default_embedding_model)
    data = response.data or []
    if not data:
        raise RuntimeError("Failed to resolve embedding dimension from OpenRouter response.")
    dimension = len(data[0].embedding or [])
    if dimension == 0:
        raise RuntimeError("OpenRouter returned an empty embedding while probing dimension.")
    _EMBED_DIMENSION_CACHE = dimension
    return dimension


def _get_or_create_index(client: Pinecone):
    name = SETTINGS.pinecone_index_name
    try:
        return client.Index(name)
    except NotFoundException:
        dimension = _embedding_dimension()
        client.create_index(
            name=name,
            dimension=dimension,
            metric="cosine",
            spec=ServerlessSpec(cloud=SETTINGS.pinecone_cloud, region=SETTINGS.pinecone_region),
        )
        return client.Index(name)


@pytest.fixture(scope="session")
def pinecone_namespace_tracker() -> Generator[_PineconeNamespaceTracker, None, None]:
    pinecone_key = os.getenv("TEST_PINECONE_API_KEY", "")
    client = Pinecone(api_key=pinecone_key)
    index = _get_or_create_index(client)
    tracker = _PineconeNamespaceTracker(index)
    try:
        yield tracker
    finally:
        tracker.cleanup()


def _collection_payload(name_suffix: str) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": f"Integration Collection {name_suffix}",
        "description": "Created via integration tests.",
        "metadata": {"test_suite": "integration"},
    }
    return payload


@pytest.fixture(scope="session")
def sample_text_path() -> Path:
    return TEXT_SAMPLE


@pytest.fixture(scope="session")
def sample_pdf_path() -> Path:
    return PDF_SAMPLE


@pytest.fixture(scope="session")
def collection_factory(
    client: TestClient,
    user_context: dict[str, object],
    pinecone_namespace_tracker: _PineconeNamespaceTracker,
):
    def _builder(overrides: dict[str, object] | None = None) -> dict[str, object]:
        suffix = uuid4().hex[:6]
        payload = _collection_payload(suffix)
        if overrides:
            payload.update(overrides)
        response = client.post("/api/collections", json=payload, headers=user_context["headers"])
        assert response.status_code == 201, response.text
        data = response.json()
        namespace = DEFAULT_NAMESPACE_TEMPLATE.replace("{collection_id}", data["id"])
        pinecone_namespace_tracker.register(namespace)
        return data

    return _builder


@pytest.fixture(scope="session")
def primary_collection(collection_factory) -> dict[str, object]:
    return collection_factory({"description": "Primary integration collection"})


@pytest.fixture(scope="session")
def ingested_documents(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
    sample_text_path: Path,
    sample_pdf_path: Path,
) -> list[dict[str, object]]:
    uploads = [
        (sample_text_path, "text/plain"),
        (sample_pdf_path, "application/pdf"),
    ]
    documents: list[dict[str, object]] = []
    for path, content_type in uploads:
        with path.open("rb") as handle:
            response = client.post(
                f"/api/collections/{primary_collection['id']}/documents",
                headers=user_context["headers"],
                files={"file": (path.name, handle, content_type)},
            )
        assert response.status_code == 201, response.text
        documents.append(response.json())
    return documents


@pytest.fixture(scope="session")
def chat_session(
    client: TestClient,
    user_context: dict[str, object],
    primary_collection: dict[str, object],
    ingested_documents: list[dict[str, object]],
) -> dict[str, object]:
    payload = {
        "content": "Summarize the uploaded TransparentRAG documents with citations.",
        "title": "Integration Chat",
        "tool_collection_ids": [primary_collection["id"]],
    }
    response = client.post(
        "/api/chat",
        headers=user_context["headers"],
        json=payload,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["messages"], "chat response missing messages"
    return data
