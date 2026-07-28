"""Client for any server speaking the OpenAI-compatible API family."""

from app.clients.openai_compat.chat import ChatCall
from app.clients.openai_compat.client import (
    OpenAICompatClient,
    close_openai_compat_clients,
    get_openai_compat_client,
    invalidate_openai_compat_client,
)
from app.clients.openai_compat.probe import EndpointProbe, ProbeOutcome, ServerProbe
from app.clients.openai_compat.rerank import RERANK_DEFAULT_PATH, RerankShape
from app.clients.openai_compat.responses import ResponsesCall
from app.clients.openai_compat.transport import (
    OpenAICompatTransport,
    TransportConfig,
    normalize_openai_base_url,
)

__all__ = [
    "RERANK_DEFAULT_PATH",
    "ChatCall",
    "EndpointProbe",
    "OpenAICompatClient",
    "OpenAICompatTransport",
    "ProbeOutcome",
    "RerankShape",
    "ResponsesCall",
    "ServerProbe",
    "TransportConfig",
    "close_openai_compat_clients",
    "get_openai_compat_client",
    "invalidate_openai_compat_client",
    "normalize_openai_base_url",
]
