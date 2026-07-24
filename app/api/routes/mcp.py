"""The collection-scoped MCP endpoint (Streamable HTTP).

One path per collection — `/api/mcp/collections/{collection_id}` — so an agent
harness adds a server whose identity *is* the collection and whose tool list is
that collection's own. The API key remains the security boundary: a key scoped
elsewhere gets the same 404 as a collection that does not exist, so the URL
reveals nothing.

The route is FastAPI wiring only: `app/mcp/gateway.py` owns the request
sequence, and `app/mcp/transport.py` the spec's transport rules.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.api.dependencies import get_session
from app.mcp.errors import TransportError
from app.mcp.gateway import McpHeaders, handle_request

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


async def read_raw_body(request: Request) -> bytes:
    """Return the request's raw body.

    An async dependency in front of a sync route: awaiting the buffered body on
    the event loop costs nothing, and it keeps the route itself sync so the
    blocking pipeline run inside a tool call stays in the threadpool.
    """
    return await request.body()


def mcp_headers(
    authorization: str | None = Header(default=None),
    origin: str | None = Header(default=None),
    accept: str | None = Header(default=None),
    mcp_protocol_version: str | None = Header(default=None, alias="MCP-Protocol-Version"),
) -> McpHeaders:
    """Collect the headers the MCP transport rules read."""
    return McpHeaders(
        authorization=authorization,
        origin=origin,
        accept=accept,
        protocol_version=mcp_protocol_version,
    )


@router.post("/collections/{collection_id}")
def handle_collection_mcp(
    collection_id: UUID,
    raw_body: bytes = Depends(read_raw_body),
    headers: McpHeaders = Depends(mcp_headers),
    session: Session = Depends(get_session),
) -> Response:
    """Answer one MCP JSON-RPC message for a collection.

    Notifications answer 202 with no body and requests a single JSON object —
    both permitted by the Streamable HTTP transport, and together what makes
    this endpoint stateless (no session id is ever issued).
    """
    try:
        result = handle_request(session, collection_id, raw_body, headers)
    except TransportError as exc:
        raise HTTPException(
            status_code=exc.status_code, detail=exc.detail, headers=exc.headers
        ) from exc
    if result.payload is None:
        return Response(status_code=result.status_code)
    return JSONResponse(status_code=result.status_code, content=result.payload)


@router.api_route("/collections/{collection_id}", methods=["GET", "DELETE"])
def unsupported_method(collection_id: UUID) -> Response:
    """Reject the optional GET stream and session termination with 405.

    A server offering no server-initiated SSE stream answers GET with 405, and
    one that issues no session id has no session for DELETE to terminate — both
    are the spec's prescribed answers, not gaps.
    """
    del collection_id
    return Response(
        status_code=status.HTTP_405_METHOD_NOT_ALLOWED, headers={"Allow": "POST"}
    )
