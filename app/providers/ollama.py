"""Ollama provider adapter."""

from __future__ import annotations

from typing import ClassVar

import httpx

from app.clients.ollama import OllamaApiError, OllamaClient, get_ollama_client
from app.db.models import ProviderConnection
from app.providers.base import (
    CatalogResult,
    ProviderAdapter,
    ProviderDescriptor,
    llm_concurrency_field,
)
from app.providers.chat.base import ChatProvider
from app.providers.chat.ollama import OllamaChatProvider, model_info_from_description
from app.retrieval.embedders.base import Embedder
from app.retrieval.embedders.ollama_embedder import OllamaEmbedder
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.ollama import OllamaModelDescription
from app.schemas.provider_configs import (
    OLLAMA_DEFAULT_PORT,
    OllamaConnectionConfig,
)
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConfigFieldKind,
    ConnectionValidationResult,
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
            placeholder=f"http://localhost:{OLLAMA_DEFAULT_PORT}",
            description=(
                "When Ragworks runs in Docker, use your machine's LAN IP or "
                f"http://host.docker.internal:{OLLAMA_DEFAULT_PORT} — localhost "
                "points at the container itself. A URL without a port is read "
                f"as port {OLLAMA_DEFAULT_PORT}."
            ),
        ),
        ProviderConfigField(
            name="api_key",
            label="API key (optional, for proxied servers)",
            kind=ConfigFieldKind.SECRET,
            required=False,
        ),
        llm_concurrency_field(1),
    ),
    docs_url="https://ollama.com/download",
)


def _input_modalities(
    description: OllamaModelDescription, kind: ProviderKind
) -> list[str]:
    """Modalities the model accepts, from its `/api/show` capabilities.

    Text is the baseline every model serves; `vision` is the server's own
    positive statement that a model also accepts images, so it is the only
    thing that adds a modality here. Embedding models take text alone
    regardless of what the tag advertises.
    """
    if kind is ProviderKind.CHAT and "vision" in description.capabilities:
        return ["text", "image"]
    return ["text"]


class OllamaAdapter(ProviderAdapter):
    """Adapter over one Ollama server connection."""

    provider_type: ClassVar[ProviderType] = ProviderType.OLLAMA
    descriptor: ClassVar[ProviderDescriptor] = OLLAMA_DESCRIPTOR
    default_llm_concurrency: ClassVar[int] = 1

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the connection config and bind the adapter."""
        super().__init__(connection)
        self._config = self.parse_config(OllamaConnectionConfig, connection.config)

    def normalized_config(self) -> dict[str, object]:
        """Persist the scheme/port-normalized URL, not the raw typed string."""
        return self._config.model_dump(exclude_none=True)

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
                    input_modalities=_input_modalities(description, kind),
                    output_modalities=["text"],
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
