"""OpenRouter provider adapter."""

from __future__ import annotations

from typing import ClassVar

import httpx

from app.clients.openrouter import OpenRouterClient, get_openrouter_client
from app.db.models import ProviderConnection
from app.providers.base import ProviderAdapter, ProviderDescriptor
from app.providers.chat.base import ChatProvider
from app.providers.chat.openrouter import OpenRouterProvider
from app.retrieval.embedders.base import Embedder
from app.retrieval.embedders.openrouter_embedder import OpenRouterEmbedder
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import EndpointsListResponse
from app.schemas.providers import (
    CatalogModel,
    ConfigFieldKind,
    ConnectionValidationResult,
    OpenRouterConnectionConfig,
    ProviderConfigField,
)

OPENROUTER_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.OPENROUTER,
    label="OpenRouter",
    kinds=(ProviderKind.EMBEDDING, ProviderKind.CHAT),
    config_fields=(
        ProviderConfigField(
            name="api_key",
            label="API key",
            kind=ConfigFieldKind.SECRET,
            required=True,
            placeholder="sk-or-...",
        ),
    ),
    docs_url="https://openrouter.ai/settings/keys",
    recommended=True,
)


class OpenRouterAdapter(ProviderAdapter):
    """Adapter over one OpenRouter account connection."""

    provider_type: ClassVar[ProviderType] = ProviderType.OPENROUTER
    descriptor: ClassVar[ProviderDescriptor] = OPENROUTER_DESCRIPTOR

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the connection config and bind the adapter."""
        super().__init__(connection)
        self._config = self.parse_config(OpenRouterConnectionConfig, connection.config)

    def _client(self) -> OpenRouterClient:
        """Return the (cached) OpenRouter client for this connection."""
        return get_openrouter_client(self._config.api_key)

    def validate_connection(self) -> ConnectionValidationResult:
        """Validate the API key against OpenRouter's `/key` endpoint."""
        try:
            self._client().get_current_key()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                return ConnectionValidationResult(
                    valid=False, message="Invalid OpenRouter API key."
                )
            return ConnectionValidationResult(
                valid=False, message="OpenRouter validation failed."
            )
        except httpx.HTTPError:
            return ConnectionValidationResult(
                valid=False, message="OpenRouter is unreachable."
            )
        return ConnectionValidationResult(valid=True, message="Connected.")

    def list_models(self, kind: ProviderKind) -> list[CatalogModel]:
        """List OpenRouter chat or embedding models for this connection."""
        self.require_kind(kind)
        client = self._client()
        if kind is ProviderKind.CHAT:
            return [
                CatalogModel(
                    connection_id=self.connection.id,
                    connection_label=self.connection.label,
                    provider_type=self.provider_type,
                    id=model.id,
                    name=model.name,
                    description=model.description,
                    context_length=model.context_length,
                    pricing=model.pricing,
                    supported_parameters=model.supported_parameters,
                    default_parameters=model.default_parameters,
                )
                for model in client.list_models()
            ]
        return [
            CatalogModel(
                connection_id=self.connection.id,
                connection_label=self.connection.label,
                provider_type=self.provider_type,
                id=model.id,
                name=model.name,
                description=model.description,
                context_length=int(model.context_length) if model.context_length else None,
                pricing=model.pricing,
                dimension=model.dimension,
            )
            for model in client.list_embedding_models()
        ]

    def embedder(self, model_name: str, dimensions: int | None = None) -> Embedder:
        """Construct an OpenRouter embedder for this connection."""
        self.require_kind(ProviderKind.EMBEDDING)
        return OpenRouterEmbedder(self._client(), model_name, dimensions=dimensions)

    def chat_provider(self) -> ChatProvider:
        """Construct an OpenRouter chat provider for this connection."""
        self.require_kind(ProviderKind.CHAT)
        return OpenRouterProvider(self._client())

    def embedding_dimension(self, model_name: str) -> int | None:
        """Probe the embedding dimension for a model."""
        self.require_kind(ProviderKind.EMBEDDING)
        return self._client().get_embedding_dimension(model_name)

    def list_model_endpoints(self, author: str, slug: str) -> EndpointsListResponse:
        """Return OpenRouter's per-provider endpoint directory for a model."""
        return self._client().list_model_endpoints(author, slug)
