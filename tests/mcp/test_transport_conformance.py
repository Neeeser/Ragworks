"""Streamable HTTP conformance: the transport rules any MCP client relies on.

These are the requirements a harness we have never tested against will assume,
so each one is pinned explicitly rather than inferred from a happy-path call:
the handshake and its version negotiation, notifications answering 202, GET and
DELETE answering 405, protocol-version and Origin rejection, and the
JSON-RPC-vs-tool-error split. The live cross-check against the official MCP
client SDK runs in the sandbox (see docs/mcp.md); this suite is the hermetic
half that fails a gate the moment a rule regresses.
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.schemas.enums import ApiKeyCapability
from app.schemas.mcp import LATEST_PROTOCOL_VERSION
from tests.mcp.conftest import CLIENT_HEADERS, issue_key, rpc


def _endpoint(collection: models.Collection) -> str:
    return f"/api/mcp/collections/{collection.id}"


def test_initialize_returns_negotiated_version_capabilities_and_instructions(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(
        mcp_client,
        mcp_collection.id,
        secret,
        "initialize",
        {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "harness", "version": "1"},
        },
    )

    result = body["result"]
    assert isinstance(result, dict)
    # The client's own version is echoed when supported, so a 2025-06-18 client
    # is never told to speak a revision it did not ask for.
    assert result["protocolVersion"] == "2025-06-18"
    assert result["capabilities"] == {"tools": {"listChanged": False}}
    # Harnesses namespace tool calls by server name, so it must be an
    # identifier — never the raw collection name with its spaces.
    assert result["serverInfo"]["name"] == "ragworks-field-notes"
    assert result["serverInfo"]["title"] == "Ragworks: Field Notes"
    # The collection's own description reaches the agent through `instructions`,
    # which is why no discovery tool is needed.
    assert "Observations from the field." in result["instructions"]


def test_initialize_with_an_unknown_version_offers_the_newest_supported(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(
        mcp_client,
        mcp_collection.id,
        secret,
        "initialize",
        {"protocolVersion": "1999-01-01", "capabilities": {}},
    )

    result = body["result"]
    assert isinstance(result, dict)
    assert result["protocolVersion"] == LATEST_PROTOCOL_VERSION


def test_notification_is_accepted_with_202_and_no_body(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={**CLIENT_HEADERS, "Authorization": f"Bearer {secret}"},
    )

    assert response.status_code == 202
    assert response.content == b""


def test_ping_answers_an_empty_result(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(mcp_client, mcp_collection.id, secret, "ping")

    assert body == {"jsonrpc": "2.0", "id": 1, "result": {}}


def test_get_and_delete_answer_405_with_an_allow_header(
    mcp_client: TestClient, mcp_collection: models.Collection
) -> None:
    for method in ("GET", "DELETE"):
        response = mcp_client.request(method, _endpoint(mcp_collection))
        assert response.status_code == 405, method
        assert response.headers["Allow"] == "POST"


def test_unsupported_protocol_version_header_is_rejected_with_400(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2020-01-01",
            "Authorization": f"Bearer {secret}",
        },
    )

    assert response.status_code == 400
    assert "Unsupported MCP-Protocol-Version" in response.json()["detail"]


def test_absent_protocol_version_header_is_accepted(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """A 2025-03-26 client sends no version header; the spec says assume it."""
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"Accept": "application/json", "Authorization": f"Bearer {secret}"},
    )

    assert response.status_code == 200


def test_foreign_origin_is_rejected_with_403(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """DNS-rebinding defense: a browser page cannot drive the endpoint."""
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={
            **CLIENT_HEADERS,
            "Origin": "https://evil.example.com",
            "Authorization": f"Bearer {secret}",
        },
    )

    assert response.status_code == 403


def test_accept_header_that_excludes_json_is_rejected_with_406(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"Accept": "text/plain", "Authorization": f"Bearer {secret}"},
    )

    assert response.status_code == 406


def test_malformed_json_answers_a_parse_error(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        content=b"{not json",
        headers={
            **CLIENT_HEADERS,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32700


def test_batched_messages_are_rejected(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """Batching was removed in 2025-06-18; an array is an invalid request."""
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        json=[{"jsonrpc": "2.0", "id": 1, "method": "ping"}],
        headers={**CLIENT_HEADERS, "Authorization": f"Bearer {secret}"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == -32600


def test_unknown_method_answers_method_not_found_in_a_200(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(mcp_client, mcp_collection.id, secret, "resources/list")

    error = body["error"]
    assert isinstance(error, dict)
    assert error["code"] == -32601


def test_unknown_tool_answers_invalid_params(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    body = rpc(
        mcp_client,
        mcp_collection.id,
        secret,
        "tools/call",
        {"name": "nope", "arguments": {}},
    )

    error = body["error"]
    assert isinstance(error, dict)
    assert error["code"] == -32602


def test_no_session_id_is_issued(
    mcp_client: TestClient, session: Session, mcp_user: models.User,
    mcp_collection: models.Collection,
) -> None:
    """Stateless by design: clients have no session to echo or terminate."""
    secret = issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.TOOLS_INVOKE],
        collection_ids=[mcp_collection.id],
    )

    response = mcp_client.post(
        _endpoint(mcp_collection),
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={**CLIENT_HEADERS, "Authorization": f"Bearer {secret}"},
    )

    assert response.status_code == 200
    assert "mcp-session-id" not in {name.lower() for name in response.headers}
