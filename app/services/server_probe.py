"""Capability discovery for an arbitrary OpenAI-compatible server.

Separate from connection CRUD because it runs before any connection exists:
it takes a bare address and reports which standard surfaces answer there, so
the add-connection form can fill its capability toggles instead of asking the
user which endpoints their server mounts.
"""

from __future__ import annotations

from pydantic import ValidationError

from app.clients.openai_compat import (
    ProbeOutcome,
    TransportConfig,
    get_openai_compat_client,
)
from app.schemas.provider_configs import CustomConnectionConfig
from app.schemas.providers import ServerProbeRequest, ServerProbeResult


def probe_server(request: ServerProbeRequest) -> ServerProbeResult:
    """Discover which standard surfaces an unsaved custom server answers on.

    Runs before a connection exists, so it takes the address directly
    rather than a connection row — this is what fills the add-connection
    form's capability toggles instead of asking the user to know which
    endpoints their server mounts.
    """
    try:
        config = CustomConnectionConfig(base_url=request.base_url, api_key=request.api_key)
    except ValidationError as exc:
        return ServerProbeResult(reachable=False, message=str(exc.errors()[0]["msg"]))
    client = get_openai_compat_client(
        TransportConfig(base_url=config.base_url, api_key=config.api_key)
    )
    result = client.probe()
    if not result.reachable:
        return ServerProbeResult(reachable=False, message=result.error)
    unauthorized = any(
        endpoint.outcome is ProbeOutcome.UNAUTHORIZED
        for endpoint in (result.chat, result.embeddings, result.rerank)
    )
    return ServerProbeResult(
        reachable=True,
        serves_chat=result.chat.available,
        serves_embeddings=result.embeddings.available,
        serves_reranking=result.rerank.available,
        serves_responses=result.responses.available,
        unauthorized=unauthorized,
        model_ids=list(result.model_ids),
        message=(
            "The server rejected the API key. Check the key rather than the capabilities below."
            if unauthorized
            else result.error
        ),
    )
