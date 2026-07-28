"""The client every OpenAI-compatible provider is built on.

One class over one transport, exposing each surface the family may serve. A
provider adapter constructs it with its own base URL, key, and headers, then
uses only the surfaces it declares — OpenRouter takes chat/embeddings/rerank,
OpenAI adds Responses, a vLLM server may serve chat alone. Nothing here is
provider-specific, which is what makes a brand-new server work with no new
client code.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from typing import Any

from app.cache import ResourceCache
from app.clients.openai_compat import catalog, embeddings, probe
from app.clients.openai_compat import chat as chat_api
from app.clients.openai_compat import rerank as rerank_api
from app.clients.openai_compat import responses as responses_api
from app.clients.openai_compat.transport import OpenAICompatTransport, TransportConfig
from app.schemas.chat_completions import (
    ChatCompletionChunk,
    ChatCompletionResponse,
    EmbeddingsResponse,
    RerankResponse,
)
from app.schemas.models import ModelInfo
from app.schemas.openai_responses import ResponsesResponse, ResponsesStreamEvent


class OpenAICompatClient:
    """Typed access to one OpenAI-compatible endpoint."""

    def __init__(self, config: TransportConfig) -> None:
        """Open the shared transport for this endpoint."""
        self._transport = OpenAICompatTransport(config)

    @property
    def base_url(self) -> str:
        """The normalized base URL requests are sent to."""
        return self._transport.base_url

    def chat(self, call: chat_api.ChatCall) -> ChatCompletionResponse:
        """Request a buffered chat completion."""
        return chat_api.chat(self._transport, call)

    def chat_stream(self, call: chat_api.ChatCall) -> Iterator[ChatCompletionChunk]:
        """Yield streaming chat-completion chunks."""
        return chat_api.chat_stream(self._transport, call)

    def create_response(self, call: responses_api.ResponsesCall) -> ResponsesResponse:
        """Request a buffered Responses-API completion."""
        return responses_api.create_response(self._transport, call)

    def stream_response(
        self, call: responses_api.ResponsesCall
    ) -> Iterator[ResponsesStreamEvent]:
        """Yield Responses-API stream events."""
        return responses_api.stream_response(self._transport, call)

    def embed(
        self,
        texts: Iterable[str],
        *,
        model: str,
        dimensions: int | None = None,
    ) -> EmbeddingsResponse:
        """Embed texts with the named model."""
        return embeddings.embed(
            self._transport, texts, model=model, dimensions=dimensions
        )

    def embedding_dimension(self, model: str) -> int | None:
        """Measure a model's vector width."""
        return embeddings.probe_embedding_dimension(self._transport, model)

    def rerank(
        self,
        *,
        model: str,
        query: str,
        documents: list[str],
        path: str = rerank_api.RERANK_DEFAULT_PATH,
        shape: rerank_api.RerankShape = rerank_api.RerankShape.JINA_COHERE,
    ) -> RerankResponse:
        """Score documents against a query using the endpoint's rerank shape."""
        return rerank_api.rerank(
            self._transport,
            model=model,
            query=query,
            documents=documents,
            path=path,
            shape=shape,
        )

    def request_json(self, method: str, path: str, *, json_body: Any = None) -> Any:
        """Issue a REST call on this endpoint's pool and return the decoded body.

        The escape hatch for surfaces outside the OpenAI-compatible family that
        a specific provider still serves on the same host (OpenRouter's `/key`
        and per-model endpoint directory). It shares the pool rather than
        opening a second one, and raises on a non-2xx so a caller can classify
        the failure by status.
        """
        response = self._transport.http.request(method, path, json=json_body)
        response.raise_for_status()
        return response.json()

    def list_model_ids(self) -> list[str]:
        """Return the model ids the endpoint publishes."""
        return catalog.list_model_ids(self._transport)

    def list_models(
        self, *, supported_parameters: list[str] | None = None
    ) -> list[ModelInfo]:
        """Return published models as `ModelInfo`."""
        return catalog.list_models(
            self._transport, supported_parameters=supported_parameters
        )

    def probe(self) -> probe.ServerProbe:
        """Discover which surfaces this endpoint serves."""
        return probe.probe_server(self._transport)

    def close(self) -> None:
        """Release the connection pool."""
        self._transport.close()


_client_cache: ResourceCache[TransportConfig, OpenAICompatClient] = ResourceCache(
    max_entries=64, key_material=repr
)


def get_openai_compat_client(config: TransportConfig) -> OpenAICompatClient:
    """Return the cached client for an endpoint, building it on first use.

    Keyed on the full transport identity so two connections to the same host
    with different keys never share a pool, and rotating a key produces a new
    entry rather than silently reusing the old credential's client.
    """
    return _client_cache.get_or_create(config, lambda: OpenAICompatClient(config))


def invalidate_openai_compat_client(config: TransportConfig) -> bool:
    """Close and drop the cached client for one endpoint identity."""
    return _client_cache.invalidate(config)


def close_openai_compat_clients() -> None:
    """Close every cached client during application shutdown."""
    _client_cache.close_all()
