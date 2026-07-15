"""Ollama provider adapter."""

from __future__ import annotations

from typing import ClassVar

import httpx

from app.clients.ollama import OllamaApiError, OllamaClient, get_ollama_client
from app.db.models import ProviderConnection
from app.providers.base import CatalogResult, ProviderAdapter, ProviderDescriptor
from app.providers.chat.base import ChatProvider
from app.providers.chat.ollama import OllamaChatProvider, model_info_from_description
from app.retrieval.embedders.base import Embedder
from app.retrieval.embedders.ollama_embedder import OllamaEmbedder
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConfigFieldKind,
    ConnectionValidationResult,
    OllamaConnectionConfig,
    ProviderConfigField,
)

OLLAMA_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.OLLAMA,
    label="Ollama",
    kinds=(ProviderKind.EMBEDDING, ProviderKind.CHAT),
    config_fields=(
        ProviderConfigField(
            name="base_url",
            label="Server URL",
            kind=ConfigFieldKind.URL,
            required=True,
            placeholder="http://localhost:11434",
            description=(
                "When Ragworks runs in Docker, use your machine's LAN IP or "
                "http://host.docker.internal:11434 — localhost points at the "
                "container itself."
            ),
        ),
        ProviderConfigField(
            name="api_key",
            label="API key (optional, for proxied servers)",
            kind=ConfigFieldKind.SECRET,
            required=False,
        ),
    ),
    docs_url="https://ollama.com/download",
)


class OllamaAdapter(ProviderAdapter):
    """Adapter over one Ollama server connection."""

    provider_type: ClassVar[ProviderType] = ProviderType.OLLAMA
    descriptor: ClassVar[ProviderDescriptor] = OLLAMA_DESCRIPTOR

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the connection config and bind the adapter."""
        super().__init__(connection)
        self._config = self.parse_config(OllamaConnectionConfig, connection.config)

    def _client(self) -> OllamaClient:
        """Return the (cached) Ollama client for this connection."""
        return get_ollama_client(self._config.base_url, self._config.api_key)

    def validate_connection(self) -> ConnectionValidationResult:
        """Validate reachability (and credentials) via `/api/version`."""
        try:
            version = self._client().version()
        except OllamaApiError as exc:
            if exc.status_code in (401, 403):
                return ConnectionValidationResult(
                    valid=False, message="The Ollama server rejected the API key."
                )
            return ConnectionValidationResult(valid=False, message=str(exc))
        except httpx.HTTPError:
            return ConnectionValidationResult(
                valid=False,
                message="The Ollama server is unreachable. Check the URL and that it is running.",
            )
        return ConnectionValidationResult(valid=True, message=f"Connected (Ollama {version}).")

    def list_models(
        self, kind: ProviderKind, *, force_refresh: bool = False
    ) -> CatalogResult:
        """List the server's local models that serve the requested kind."""
        self.require_kind(kind)
        capability = "embedding" if kind is ProviderKind.EMBEDDING else "completion"
        entries: list[CatalogModel] = []
        snapshot = self._client().describe_models(force_refresh=force_refresh)
        for description in snapshot.value:
            if capability not in description.capabilities:
                continue
            info = model_info_from_description(description)
            entries.append(
                CatalogModel(
                    connection_id=self.connection.id,
                    connection_label=self.connection.label,
                    provider_type=self.provider_type,
                    id=description.name,
                    name=description.name,
                    description=info.description,
                    context_length=description.context_length,
                    max_input_tokens=(
                        description.context_length
                        if kind is ProviderKind.EMBEDDING
                        else None
                    ),
                    dimension=(
                        description.embedding_dimension
                        if kind is ProviderKind.EMBEDDING
                        else None
                    ),
                    supported_parameters=(
                        info.supported_parameters if kind is ProviderKind.CHAT else []
                    ),
                )
            )
        return CatalogResult(
            models=entries,
            meta=CatalogMetadata(
                freshness=snapshot.freshness,
                age_seconds=snapshot.age_seconds,
                refreshing=snapshot.refreshing,
                warning=snapshot.warning,
            ),
        )

    def embedder(self, model_name: str, dimensions: int | None = None) -> Embedder:
        """Construct an Ollama embedder for this connection."""
        self.require_kind(ProviderKind.EMBEDDING)
        return OllamaEmbedder(self._client(), model_name, dimensions=dimensions)

    def chat_provider(self) -> ChatProvider:
        """Construct an Ollama chat provider for this connection."""
        self.require_kind(ProviderKind.CHAT)
        return OllamaChatProvider(self._client())

    def embedding_dimension(self, model_name: str) -> int | None:
        """Read the embedding dimension from architecture metadata, probing as fallback."""
        self.require_kind(ProviderKind.EMBEDDING)
        for description in self._client().describe_models().value:
            if description.name == model_name and description.embedding_dimension:
                return description.embedding_dimension
        response = self._client().embed(["dimension_probe"], model=model_name)
        if response.embeddings:
            return len(response.embeddings[0])
        return None

    def embedding_input_limit(self, model_name: str) -> int | None:
        """Read `/api/show` context metadata without loading the model."""
        self.require_kind(ProviderKind.EMBEDDING)
        normalized = model_name.casefold()
        for description in self._client().describe_models().value:
            if (
                description.name.casefold() == normalized
                and "embedding" in description.capabilities
            ):
                return description.context_length
        return None
