from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Generator, Optional
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pinecone import Pinecone, ServerlessSpec
from pinecone.exceptions import NotFoundException

REQUIRED_ENV_VARS = [
    "OPENROUTER_API_KEY",
    "PINECONE_API_KEY",
    "PINECONE_INDEX_NAME",
    "JWT_SECRET_KEY",
]

TEST_ROOT = Path(__file__).resolve().parent / ".integration"
DB_PATH = TEST_ROOT / "integration.db"
STORAGE_PATH = TEST_ROOT / "storage"
ENV_FILES = [Path(".env"), Path(".env.local")]
_EMBED_DIMENSION_CACHE: Optional[int] = None


def _load_env_files() -> None:
    for env_path in ENV_FILES:
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def _prepare_environment() -> None:
    _load_env_files()
    missing = [env for env in REQUIRED_ENV_VARS if not os.getenv(env)]
    if missing:
        raise pytest.UsageError(
            "Integration tests require configured credentials. Missing: " + ", ".join(missing)
        )

    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()
    if STORAGE_PATH.exists():
        shutil.rmtree(STORAGE_PATH)

    os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
    os.environ["FILE_STORAGE_PATH"] = str(STORAGE_PATH)


_prepare_environment()

from app.api import config as api_config
from app.services.openrouter import get_openrouter_client

api_config.get_settings.cache_clear()

from app.db.session import init_db  # noqa: E402
from app.api.main import app  # noqa: E402

init_db()


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
        data={"username": user_credentials["email"], "password": user_credentials["password"]},
    )
    assert token_resp.status_code == 200, token_resp.text
    token = token_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me_resp = client.get("/api/auth/me", headers=headers)
    assert me_resp.status_code == 200, me_resp.text

    return {
        "headers": headers,
        "user": me_resp.json(),
        "credentials": user_credentials,
    }


SETTINGS = api_config.get_settings()
ASSETS_DIR = Path(__file__).resolve().parent / "assets"
TEXT_SAMPLE = ASSETS_DIR / "sample.txt"
PDF_SAMPLE = ASSETS_DIR / "sample.pdf"


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
            except Exception as exc:
                print(f"Failed to delete Pinecone namespace {namespace}: {exc}")


def _embedding_dimension() -> int:
    global _EMBED_DIMENSION_CACHE
    if _EMBED_DIMENSION_CACHE:
        return _EMBED_DIMENSION_CACHE
    openrouter = get_openrouter_client()
    response = openrouter.embed(["dimension probe"], model=SETTINGS.default_embedding_model)
    data = response.get("data", [])
    if not data:
        raise RuntimeError("Failed to resolve embedding dimension from OpenRouter response.")
    dimension = len(data[0].get("embedding", []))
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
    client = Pinecone(api_key=SETTINGS.pinecone_api_key)
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
        "chunk_settings": {"strategy": "token", "chunk_size": 256, "chunk_overlap": 32},
        "metadata": {"test_suite": "integration"},
    }
    if SETTINGS.default_embedding_model:
        payload["embedding_model"] = SETTINGS.default_embedding_model
    if SETTINGS.default_chat_model:
        payload["chat_model"] = SETTINGS.default_chat_model
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
        pinecone_namespace_tracker.register(data["pinecone_namespace"])
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
    }
    response = client.post(
        f"/api/collections/{primary_collection['id']}/chat",
        headers=user_context["headers"],
        json=payload,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["messages"], "chat response missing messages"
    return data
