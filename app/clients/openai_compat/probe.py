"""Capability discovery for a server we know nothing about.

A custom endpoint is probed by POSTing an empty body to each candidate path and
reading the *status*, never the payload. The discrimination that matters is
404 (this server does not serve that surface) versus 400/422 (it does, and it
rejected our deliberately-invalid body) — which costs no tokens, needs no model
name, and works before the user has picked a model. A real one-token call would
bill the user just to render a form, and could not run at all on a server whose
model list is empty.

401/403 is reported as its own outcome rather than folded into "absent": a
gateway that rejects the key answers that way on *every* path, and reporting
"this server has no chat endpoint" would send the user to fix the wrong field.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from http import HTTPStatus

import httpx

from app.clients.openai_compat.transport import OpenAICompatTransport

CHAT_PATH = "/chat/completions"
EMBEDDINGS_PATH = "/embeddings"
RERANK_PATH = "/rerank"
RESPONSES_PATH = "/responses"


class ProbeOutcome(StrEnum):
    """What a single endpoint probe concluded."""

    AVAILABLE = "available"
    ABSENT = "absent"
    UNAUTHORIZED = "unauthorized"
    UNREACHABLE = "unreachable"


@dataclass(frozen=True)
class EndpointProbe:
    """One probed path and what it reported."""

    path: str
    outcome: ProbeOutcome
    status_code: int | None = None

    @property
    def available(self) -> bool:
        """True when the server serves this path."""
        return self.outcome is ProbeOutcome.AVAILABLE


@dataclass(frozen=True)
class ServerProbe:
    """Everything one probing pass learned about a server."""

    reachable: bool
    chat: EndpointProbe
    embeddings: EndpointProbe
    rerank: EndpointProbe
    responses: EndpointProbe
    model_ids: tuple[str, ...] = ()
    error: str | None = None


def probe_endpoint(transport: OpenAICompatTransport, path: str) -> EndpointProbe:
    """Classify one path by the status it returns for an empty POST."""
    try:
        response = transport.http.post(path, json={})
    except httpx.HTTPError:
        return EndpointProbe(path=path, outcome=ProbeOutcome.UNREACHABLE)
    status = response.status_code
    if status in (HTTPStatus.UNAUTHORIZED, HTTPStatus.FORBIDDEN):
        return EndpointProbe(path, ProbeOutcome.UNAUTHORIZED, status)
    if status in (HTTPStatus.NOT_FOUND, HTTPStatus.NOT_IMPLEMENTED):
        return EndpointProbe(path, ProbeOutcome.ABSENT, status)
    return EndpointProbe(path, ProbeOutcome.AVAILABLE, status)


def _probe_models(transport: OpenAICompatTransport) -> tuple[tuple[str, ...], str | None]:
    """Fetch the model listing, tolerating a server that does not publish one."""
    from app.clients.openai_compat.catalog import list_model_ids

    try:
        return tuple(list_model_ids(transport)), None
    except httpx.HTTPStatusError as exc:
        return (), f"Model listing returned HTTP {exc.response.status_code}."
    except (httpx.HTTPError, ValueError) as exc:
        return (), f"Model listing failed: {exc}"


def probe_server(transport: OpenAICompatTransport) -> ServerProbe:
    """Probe every surface a custom connection can expose."""
    chat = probe_endpoint(transport, CHAT_PATH)
    if chat.outcome is ProbeOutcome.UNREACHABLE:
        unreachable = EndpointProbe(path="", outcome=ProbeOutcome.UNREACHABLE)
        return ServerProbe(
            reachable=False,
            chat=chat,
            embeddings=unreachable,
            rerank=unreachable,
            responses=unreachable,
            error="The server is unreachable. Check the URL and that it is running.",
        )
    model_ids, error = _probe_models(transport)
    return ServerProbe(
        reachable=True,
        chat=chat,
        embeddings=probe_endpoint(transport, EMBEDDINGS_PATH),
        rerank=probe_endpoint(transport, RERANK_PATH),
        responses=probe_endpoint(transport, RESPONSES_PATH),
        model_ids=model_ids,
        error=error,
    )
