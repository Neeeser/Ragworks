"""Fixtures for the MCP endpoint tests.

MCP requests authenticate with a real API key, never a JWT, so these tests use
a `TestClient` with *no* auth override — the key is the thing under test. A
helper issues keys through `ApiKeyService` (the real issuance path) and returns
the plaintext secret the way the creation endpoint does.
"""

from __future__ import annotations

from collections.abc import Iterator
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.dependencies import get_session
from app.api.main import app
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.api_keys import ApiKeyCreate
from app.schemas.enums import ApiKeyCapability
from app.services.api_keys import ApiKeyService
from app.services.app_config import invalidate_app_config_cache
from tests.utils.providers import install_default_pipelines

#: Every MCP POST sends the headers a compliant client sends.
CLIENT_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
}


@pytest.fixture(name="mcp_user")
def mcp_user_fixture(session: Session) -> models.User:
    """A user with the default pipelines installed."""
    user = models.User(email="agent@example.com", full_name="Agent", hashed_password="hashed")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    session.commit()
    return user


@pytest.fixture(name="mcp_collection")
def mcp_collection_fixture(session: Session, mcp_user: models.User) -> models.Collection:
    """A collection owned by `mcp_user`, with its default tool binding."""
    from app.schemas.collections import CollectionCreate
    from app.services.collections import CollectionService

    collection = CollectionService(session).create(
        mcp_user,
        CollectionCreate(name="Field Notes", description="Observations from the field."),
    )
    session.commit()
    session.refresh(collection)
    return collection


@pytest.fixture(name="mcp_client")
def mcp_client_fixture(session: Session) -> Iterator[TestClient]:
    """A TestClient bound to the test session with real (key) authentication."""
    app.dependency_overrides[get_session] = lambda: session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_config_cache() -> Iterator[None]:
    """Keep the TTL-cached app config from leaking between these tests."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def issue_key(
    session: Session,
    user: models.User,
    *,
    capabilities: list[ApiKeyCapability],
    collection_ids: list[UUID] | None = None,
    all_collections: bool = False,
) -> str:
    """Issue a key and return its plaintext secret."""
    _, secret = ApiKeyService(session).issue(
        user,
        ApiKeyCreate(
            name="agent harness",
            capabilities=capabilities,
            all_collections=all_collections,
            collection_ids=collection_ids or [],
        ),
    )
    session.commit()
    return secret


def rpc(
    client: TestClient,
    collection_id: UUID,
    secret: str,
    method: str,
    params: dict[str, object] | None = None,
    *,
    message_id: int | str | None = 1,
) -> dict[str, object]:
    """Send one JSON-RPC message and return the parsed response body."""
    body: dict[str, object] = {"jsonrpc": "2.0", "method": method}
    if message_id is not None:
        body["id"] = message_id
    if params is not None:
        body["params"] = params
    response = client.post(
        f"/api/mcp/collections/{collection_id}",
        json=body,
        headers={**CLIENT_HEADERS, "Authorization": f"Bearer {secret}"},
    )
    assert response.status_code == 200, response.text
    parsed: dict[str, object] = response.json()
    return parsed
