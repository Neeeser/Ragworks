"""Adapter for any server reached through the standard APIs.

This is the provider for servers Ragworks has no integration for: a vLLM,
llama.cpp, LM Studio, TGI, LocalAI, Infinity, or gateway endpoint that speaks
the standard shapes. It writes no wire code of its own — chat goes through the
Chat Completions or Responses dialect, embeddings through OpenAI-compatible
`/v1/embeddings`, and reranking through the Jina/Cohere or TEI shape. Adding a
server is a URL, not a code change, which is the entire point.

Which surfaces a connection serves is stored on the connection rather than
inferred per call. `POST /api/providers/probe` discovers them and the
add-connection form shows what it found; the stored flags are what the user
confirmed, so a server that answers slowly or was briefly down does not quietly
lose a capability the user knows it has.
"""

from __future__ import annotations

from typing import ClassVar

import httpx

from app.clients.openai_compat import (
    OpenAICompatClient,
    RerankShape,
    TransportConfig,
    get_openai_compat_client,
)
from app.db.models import ProviderConnection
from app.providers.base import (
    CatalogResult,
    ProviderAdapter,
    ProviderDescriptor,
    kind_rpm_field,
    max_embedding_inputs_field,
    request_concurrency_field,
    request_rpm_field,
)
from app.providers.chat.base import ChatProvider
from app.providers.chat.dialects import (
    CHAT_COMPLETIONS_PARAMETERS,
    RESPONSES_PARAMETERS,
    ChatCompletionsProvider,
    ResponsesProvider,
)
from app.providers.chat.dialects.chat_completions import DIALECT_FLOOR_CAPABILITIES
from app.providers.openai_catalog import is_chat_model, is_embedding_model
from app.retrieval.embedders.base import Embedder
from app.retrieval.embedders.openai_compat_embedder import OpenAICompatEmbedder
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.openai_compat import OpenAICompatReranker
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import ChatCapabilities
from app.schemas.provider_configs import (
    OPENAI_COMPAT_DEFAULT_PORT,
    ChatDialect,
    CustomConnectionConfig,
    RerankDialect,
)
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConfigFieldKind,
    ConnectionValidationResult,
    ProviderConfigField,
    ProviderConfigOption,
)

CUSTOM_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.CUSTOM,
    label="Custom server",
    # Every kind is advertised so the connection form can render before the
    # probe runs; `kinds` narrows to what the saved connection actually serves.
    kinds=(ProviderKind.CHAT, ProviderKind.EMBEDDING, ProviderKind.RERANKING),
    config_fields=(
        ProviderConfigField(
            name="base_url",
            label="Server URL",
            kind=ConfigFieldKind.URL,
            required=True,
            placeholder=f"http://localhost:{OPENAI_COMPAT_DEFAULT_PORT}",
            description=(
                "The server's API root. A URL without a path is read as /v1; a "
                f"URL without a port is read as port {OPENAI_COMPAT_DEFAULT_PORT}."
            ),
        ),
        ProviderConfigField(
            name="api_key",
            label="API key (optional)",
            kind=ConfigFieldKind.SECRET,
            required=False,
        ),
        ProviderConfigField(
            name="serves_chat",
            label="Serves chat",
            kind=ConfigFieldKind.BOOLEAN,
            required=False,
            default=True,
        ),
        ProviderConfigField(
            name="serves_embeddings",
            label="Serves embeddings",
            kind=ConfigFieldKind.BOOLEAN,
            required=False,
            default=True,
        ),
        ProviderConfigField(
            name="serves_reranking",
            label="Serves reranking",
            kind=ConfigFieldKind.BOOLEAN,
            required=False,
            default=False,
        ),
        ProviderConfigField(
            name="chat_dialect",
            label="Chat API",
            kind=ConfigFieldKind.SELECT,
            required=False,
            advanced=True,
            default=ChatDialect.CHAT_COMPLETIONS.value,
            options=(
                ProviderConfigOption(
                    value=ChatDialect.CHAT_COMPLETIONS.value, label="Chat Completions"
                ),
                ProviderConfigOption(value=ChatDialect.RESPONSES.value, label="Responses"),
            ),
        ),
        ProviderConfigField(
            name="rerank_dialect",
            label="Rerank API",
            kind=ConfigFieldKind.SELECT,
            required=False,
            advanced=True,
            default=RerankDialect.JINA_COHERE.value,
            description=(
                "Jina/Cohere is what vLLM, Jina, and Cohere serve. TEI is Hugging "
                "Face Text Embeddings Inference's own shape."
            ),
            options=(
                ProviderConfigOption(value=RerankDialect.JINA_COHERE.value, label="Jina / Cohere"),
                ProviderConfigOption(value=RerankDialect.TEI.value, label="TEI"),
            ),
        ),
        ProviderConfigField(
            name="rerank_path",
            label="Rerank path",
            kind=ConfigFieldKind.STRING,
            required=False,
            advanced=True,
            default="/rerank",
            placeholder="/rerank",
        ),
        request_concurrency_field(2),
        request_rpm_field(None),
        kind_rpm_field("Embedding", "embedding_requests_per_minute", None),
        kind_rpm_field("Reranking", "rerank_requests_per_minute", None),
        max_embedding_inputs_field(None),
    ),
    docs_url="https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
)

_KIND_FLAGS: dict[ProviderKind, str] = {
    ProviderKind.CHAT: "serves_chat",
    ProviderKind.EMBEDDING: "serves_embeddings",
    ProviderKind.RERANKING: "serves_reranking",
}


class CustomAdapter(ProviderAdapter):
    """Adapter over one user-declared OpenAI-compatible server."""

    provider_type: ClassVar[ProviderType] = ProviderType.CUSTOM
    descriptor: ClassVar[ProviderDescriptor] = CUSTOM_DESCRIPTOR
    default_request_concurrency: ClassVar[int] = 2
    default_request_rpm: ClassVar[int | None] = None

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the connection config and bind the adapter."""
        super().__init__(connection)
        self._config = self.parse_config(CustomConnectionConfig, connection.config)

    def normalized_config(self) -> dict[str, object]:
        """Persist the scheme/port-normalized URL and the confirmed capabilities."""
        return self._config.model_dump(mode="json", exclude_none=True)

    @property
    def kinds(self) -> tuple[ProviderKind, ...]:
        """Return only the capabilities this connection is configured to serve."""
        return tuple(kind for kind, flag in _KIND_FLAGS.items() if getattr(self._config, flag))

    def transport_config(self) -> TransportConfig:
        """Return the endpoint identity this connection's client is keyed by."""
        return TransportConfig(base_url=self._config.base_url, api_key=self._config.api_key)

    def _client(self) -> OpenAICompatClient:
        """Return the cached client for this server."""
        return get_openai_compat_client(self.transport_config())

    def validate_connection(self) -> ConnectionValidationResult:
        """Probe the server and report which of the declared surfaces answer."""
        result = self._client().probe()
        if not result.reachable:
            return ConnectionValidationResult(
                valid=False,
                message=result.error
                or "The server is unreachable. Check the URL and that it is running.",
            )
        declared = self.kinds
        if not declared:
            return ConnectionValidationResult(
                valid=False,
                message="Select at least one capability this server serves.",
            )
        probes = {
            ProviderKind.CHAT: result.chat,
            ProviderKind.EMBEDDING: result.embeddings,
            ProviderKind.RERANKING: result.rerank,
        }
        missing = [kind.value for kind in declared if not probes[kind].available]
        if missing:
            return ConnectionValidationResult(
                valid=False,
                message=(
                    f"The server did not answer on {', '.join(missing)}. "
                    "Uncheck what it does not serve, or correct the URL."
                ),
            )
        served = ", ".join(kind.value for kind in declared)
        return ConnectionValidationResult(
            valid=True, message=f"Connected ({len(result.model_ids)} models; {served})."
        )

    def _chat_parameters(self) -> list[str]:
        """Return the parameter set this connection's chat dialect accepts."""
        if self._config.chat_dialect is ChatDialect.RESPONSES:
            return list(RESPONSES_PARAMETERS)
        return list(CHAT_COMPLETIONS_PARAMETERS)

    @staticmethod
    def _ordered_for_kind(model_ids: list[str], kind: ProviderKind) -> list[str]:
        """Order a listing so the likely matches for a kind come first.

        A custom server publishes ids and no modality, so nothing here can
        *know* what a model is — which is why this orders rather than filters.
        Filtering would hide a model the server genuinely serves whenever the
        naming convention differs, and one-model servers (the common case) have
        nothing to hide anyway. Ordering costs nothing when the listing is one
        model and stops a 100-model gateway from burying its embedding models
        under every chat model it also serves.
        """
        if kind is ProviderKind.EMBEDDING:
            likely = is_embedding_model
        elif kind is ProviderKind.CHAT:
            likely = is_chat_model
        else:
            return sorted(model_ids)
        return sorted(model_ids, key=lambda model_id: (not likely(model_id), model_id))

    def list_models(self, kind: ProviderKind, *, force_refresh: bool = False) -> CatalogResult:
        """Return every published model for the requested kind, likely ones first."""
        del force_refresh
        self.require_kind(kind)
        try:
            model_ids = self._ordered_for_kind(self._client().list_model_ids(), kind)
        except (httpx.HTTPError, ValueError):
            model_ids = []
        parameters = self._chat_parameters() if kind is ProviderKind.CHAT else []
        modality = {
            ProviderKind.CHAT: "text",
            ProviderKind.EMBEDDING: "embedding",
            ProviderKind.RERANKING: "rerank",
        }[kind]
        models = [
            CatalogModel(
                connection_id=self.connection.id,
                connection_label=self.connection.label,
                provider_type=self.provider_type,
                id=model_id,
                name=model_id,
                # The OpenAI spec an arbitrary compatible server implements
                # states text input and publishes no modality block, so text
                # is the whole of what such a server declares.
                input_modalities=["text"],
                output_modalities=[modality],
                supported_parameters=parameters,
                capabilities=(
                    DIALECT_FLOOR_CAPABILITIES if kind is ProviderKind.CHAT else ChatCapabilities()
                ),
            )
            for model_id in model_ids
        ]
        return CatalogResult(models=models, meta=CatalogMetadata())

    def chat_provider(self) -> ChatProvider:
        """Construct the chat provider for this server's configured dialect."""
        self.require_kind(ProviderKind.CHAT)
        client = self._client()
        name = f"custom:{self.connection.label}"
        if self._config.chat_dialect is ChatDialect.RESPONSES:
            return ResponsesProvider(client, name=name)
        return ChatCompletionsProvider(client, name=name)

    def embedder(self, model_name: str, dimensions: int | None = None) -> Embedder:
        """Construct an embedder over the server's embeddings endpoint."""
        self.require_kind(ProviderKind.EMBEDDING)
        return OpenAICompatEmbedder(
            self._client(),
            model_name,
            provider_label=self.connection.label,
            dimensions=dimensions,
        )

    def reranker(self, model_name: str) -> Reranker:
        """Construct a reranker over the server's configured rerank shape."""
        self.require_kind(ProviderKind.RERANKING)
        shape = (
            RerankShape.TEI
            if self._config.rerank_dialect is RerankDialect.TEI
            else RerankShape.JINA_COHERE
        )
        return OpenAICompatReranker(
            self._client(),
            model_name,
            path=self._config.rerank_path,
            shape=shape,
        )

    def embedding_dimension(self, model_name: str) -> int | None:
        """Measure the model's vector width with a single-input call."""
        self.require_kind(ProviderKind.EMBEDDING)
        return self._client().embedding_dimension(model_name)

    def embedding_input_limit(self, model_name: str) -> int | None:
        """A generic OpenAI-compatible server publishes no input limit."""
        del model_name
        self.require_kind(ProviderKind.EMBEDDING)
        return None
