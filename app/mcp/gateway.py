"""One MCP HTTP request, start to finish: transport rules, auth, dispatch.

The route owns nothing but FastAPI wiring; this module is where a request's
sequence actually lives, in one auditable place: validate the transport headers,
authenticate the key, check the deployment flag, authorize the collection, then
dispatch the JSON-RPC message. It answers with a transport-neutral
`McpHttpResponse` (status plus optional JSON body) so the ordering is testable
without an HTTP client.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.repositories import CollectionRepository
from app.mcp.errors import INTERNAL_ERROR, ProtocolError, TransportError
from app.mcp.server import McpServer
from app.mcp.tools.base import McpToolContext
from app.mcp.transport import (
    error_payload,
    negotiate_header_version,
    parse_message,
    require_json_acceptable,
    success_payload,
    validate_origin,
)
from app.observability import events, get_logger
from app.schemas.mcp import CallToolResult
from app.services.api_keys import ApiKeyService, InvalidApiKeyError, KeyPrincipal
from app.services.app_config import get_app_config

logger = get_logger(__name__)

#: Sent with every 401 so a client knows which scheme to use.
UNAUTHENTICATED_HEADERS = {
    "WWW-Authenticate": 'Bearer realm="ragworks", error="invalid_token"'
}


@dataclass(frozen=True)
class McpHeaders:
    """The request headers the transport rules read."""

    authorization: str | None = None
    origin: str | None = None
    accept: str | None = None
    protocol_version: str | None = None


@dataclass(frozen=True)
class McpHttpResponse:
    """A transport-neutral answer: a status, and a JSON body when there is one."""

    status_code: int
    payload: dict[str, Any] | None = None


def handle_request(
    session: Session, collection_id: UUID, body: bytes, headers: McpHeaders
) -> McpHttpResponse:
    """Serve one MCP request for a collection.

    Raises `TransportError` for HTTP-level rejections (bad origin, unsupported
    protocol version, missing or invalid key, out-of-scope collection); every
    JSON-RPC outcome — including errors — comes back as a response.
    """
    validate_origin(headers.origin, get_settings().cors_origins)
    require_json_acceptable(headers.accept)
    negotiate_header_version(headers.protocol_version)
    principal = _authenticate(session, headers.authorization)
    _require_enabled()
    collection = _authorized_collection(session, principal, collection_id)

    try:
        message = parse_message(body)
    except ProtocolError as exc:
        return McpHttpResponse(400, error_payload(None, exc))

    server = McpServer(
        McpToolContext(
            session=session,
            user=principal.user,
            collection=collection,
            principal=principal,
        )
    )
    try:
        result = server.handle(message)
    except ProtocolError as exc:
        return McpHttpResponse(200, error_payload(message.id, exc))
    except Exception as exc:  # pylint: disable=broad-exception-caught
        # A bug must still reach the client as a parseable JSON-RPC error rather
        # than an HTML 500 no MCP client can read. Logged with the request's
        # correlation id; never swallowed silently.
        session.rollback()
        logger.exception(
            events.MCP_TOOL_FAILED,
            method=message.method,
            collection_id=str(collection.id),
            error_type=type(exc).__name__,
        )
        if message.id is None:
            return McpHttpResponse(202)
        return McpHttpResponse(
            200,
            error_payload(message.id, ProtocolError(INTERNAL_ERROR, "Internal server error.")),
        )

    if isinstance(result, CallToolResult):
        logger.info(
            events.MCP_TOOL_CALLED,
            tool=str((message.params or {}).get("name")),
            collection_id=str(collection.id),
            user_id=str(principal.user.id),
            ok=not result.is_error,
        )
    ApiKeyService(session).record_use(principal.api_key)
    session.commit()
    if result is None or message.id is None:
        return McpHttpResponse(202)
    return McpHttpResponse(200, success_payload(message.id, result))


def _require_enabled() -> None:
    """Reject MCP traffic when the deployment has the feature switched off.

    Checked after authentication so an unauthenticated probe cannot read the
    deployment's configuration off the status code.
    """
    if not get_app_config().features.mcp_access:
        raise TransportError(403, "MCP access is disabled for this deployment.")


def _authenticate(session: Session, authorization: str | None) -> KeyPrincipal:
    """Resolve the bearer credential to a principal, or raise a 401.

    Every rejection reason answers the same 401 so a probe cannot tell an
    unknown key from a revoked one; the reason is logged, never returned.
    """
    scheme, _, secret = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not secret.strip():
        logger.info(events.MCP_AUTH_REJECTED, reason="missing_bearer")
        raise TransportError(401, "An API key is required.", dict(UNAUTHENTICATED_HEADERS))
    try:
        return ApiKeyService(session).verify(secret.strip())
    except InvalidApiKeyError as exc:
        logger.info(events.MCP_AUTH_REJECTED, reason=exc.reason)
        raise TransportError(
            401, "Invalid API key.", dict(UNAUTHENTICATED_HEADERS)
        ) from exc


def _authorized_collection(
    session: Session, principal: KeyPrincipal, collection_id: UUID
) -> models.Collection:
    """Return the collection this key may serve, else a 404.

    Out-of-scope and non-existent are the same answer on purpose: a key holder
    must not be able to enumerate collections it was not granted.
    """
    collection = CollectionRepository(session).get(collection_id, user_id=principal.user.id)
    if collection is None or not principal.reaches_collection(collection.id):
        raise TransportError(404, "Collection not found.")
    return collection
