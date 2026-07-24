"""Who may reach an MCP endpoint, and what they see when they may not.

The URL names a collection but the key decides: a key scoped to another
collection, a revoked or expired key, and a collection that does not exist all
answer identically, so a key holder cannot enumerate anything it was not
granted. Capability filtering is asserted here too, because "the tool is
absent" (not "the call is refused") is the contract the design rests on.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from httpx import Response
from sqlmodel import Session

from app.db import models
from app.db.repositories import ApiKeyRepository, AppSettingRepository, UserRepository
from app.schemas.collections import CollectionCreate
from app.schemas.enums import ApiKeyCapability
from app.services.api_keys import ApiKeyService
from app.services.app_config import invalidate_app_config_cache
from app.services.collections import CollectionService
from app.utils.time import utc_now
from tests.mcp.conftest import CLIENT_HEADERS, issue_key, rpc
from tests.utils.providers import install_default_pipelines


def _tool_names(body: dict[str, object]) -> list[str]:
    result = body["result"]
    assert isinstance(result, dict)
    return [tool["name"] for tool in result["tools"]]


def _post(client: TestClient, collection_id: object, secret: str | None) -> Response:
    headers = dict(CLIENT_HEADERS)
    if secret is not None:
        headers["Authorization"] = f"Bearer {secret}"
    return client.post(
        f"/api/mcp/collections/{collection_id}",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        headers=headers,
    )


def test_request_without_a_key_is_401_with_a_bearer_challenge(
    mcp_client: TestClient, mcp_collection: models.Collection
) -> None:
    response = _post(mcp_client, mcp_collection.id, None)

    assert response.status_code == 401
    assert "Bearer" in response.headers["WWW-Authenticate"]


def test_unknown_key_is_401(
    mcp_client: TestClient, mcp_collection: models.Collection
) -> None:
    response = _post(mcp_client, mcp_collection.id, "rw_not-a-real-key")

    assert response.status_code == 401


def test_revoked_key_is_401(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )
    key = ApiKeyService(session).list_keys(mcp_user)[0]
    ApiKeyService(session).revoke(mcp_user, key.id)
    session.commit()

    response = _post(mcp_client, mcp_collection.id, secret)

    assert response.status_code == 401


def test_expired_key_is_401(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )
    key = ApiKeyRepository(session).list_for_user(mcp_user.id)[0]
    key.expires_at = utc_now() - timedelta(seconds=1)
    session.add(key)
    session.commit()

    response = _post(mcp_client, mcp_collection.id, secret)

    assert response.status_code == 401


def test_key_scoped_to_another_collection_is_404(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    other = CollectionService(session).create(
        mcp_user, CollectionCreate(name="Other", description="")
    )
    session.commit()
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[other.id],
    )

    response = _post(mcp_client, mcp_collection.id, secret)

    assert response.status_code == 404


def test_all_collections_key_reaches_a_collection_created_later(
    mcp_client: TestClient, session: Session, mcp_user: models.User
) -> None:
    """`all_collections` is a standing grant, not a snapshot of ids."""
    secret = issue_key(
        session, mcp_user, capabilities=[ApiKeyCapability.TOOLS_INVOKE], all_collections=True
    )
    later = CollectionService(session).create(
        mcp_user, CollectionCreate(name="Created Later", description="")
    )
    session.commit()

    response = _post(mcp_client, later.id, secret)

    assert response.status_code == 200


def test_another_users_collection_is_404_even_with_a_valid_key(
    mcp_client: TestClient, session: Session, mcp_user: models.User
) -> None:
    stranger = models.User(
        email="stranger@example.com", full_name="S", hashed_password="hashed"
    )
    UserRepository(session).add(stranger)
    session.commit()
    session.refresh(stranger)
    install_default_pipelines(session, stranger)
    theirs = CollectionService(session).create(
        stranger, CollectionCreate(name="Private", description="")
    )
    session.commit()
    secret = issue_key(
        session, mcp_user, capabilities=[ApiKeyCapability.TOOLS_INVOKE], all_collections=True
    )

    response = _post(mcp_client, theirs.id, secret)

    assert response.status_code == 404


def test_tools_only_key_sees_no_file_tools(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    names = _tool_names(rpc(mcp_client, mcp_collection.id, secret, "tools/list"))

    assert names == ["search_field_notes"]


def test_files_read_key_sees_read_tools_but_no_write_tools(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.FILES_READ],
        collection_ids=[mcp_collection.id],
    )

    names = _tool_names(rpc(mcp_client, mcp_collection.id, secret, "tools/list"))

    assert names == ["list_files", "read_file", "search_files"]


def test_a_tool_outside_the_keys_capabilities_cannot_be_called_by_name(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """Absent from the listing *and* unknown to the call — one gate, not two."""
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.FILES_READ],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(
        mcp_client,
        mcp_collection.id,
        secret,
        "tools/call",
        {"name": "delete_file", "arguments": {"path": "anything"}},
    )

    error = body["error"]
    assert isinstance(error, dict)
    assert error["code"] == -32602


def test_disabling_the_feature_flag_rejects_authenticated_requests(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )
    AppSettingRepository(session).upsert("features.mcp_access", False, None)
    session.commit()
    invalidate_app_config_cache()

    response = _post(mcp_client, mcp_collection.id, secret)

    assert response.status_code == 403


def test_a_served_request_stamps_the_keys_last_use(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )
    assert ApiKeyRepository(session).list_for_user(mcp_user.id)[0].last_used_at is None

    rpc(mcp_client, mcp_collection.id, secret, "tools/list")

    with Session(session.get_bind()) as fresh:
        stored = ApiKeyRepository(fresh).list_for_user(mcp_user.id)[0]
        assert stored.last_used_at is not None
