"""Cohere provider adapter."""

from __future__ import annotations

from typing import ClassVar, TypeVar

import httpx

from app.cache import CacheSnapshot
from app.clients.cohere import CohereClient, get_cohere_client
from app.db.models import ProviderConnection
from app.providers.base import CatalogResult, ProviderAdapter, ProviderDescriptor
from app.providers.chat.base import ChatProvider
from app.providers.chat.cohere import CohereChatProvider
from app.retrieval.embedders.base import Embedder
from app.retrieval.embedders.cohere_embedder import CohereEmbedder
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.cohere import CohereReranker
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    CohereConnectionConfig,
    ConfigFieldKind,
    ConnectionValidationResult,
    ProviderConfigField,
)

COHERE_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.COHERE,
    label="Cohere",
    kinds=(ProviderKind.EMBEDDING, ProviderKind.CHAT, ProviderKind.RERANKING),
    config_fields=(
        ProviderConfigField(
            name="api_key",
            label="API key",
            kind=ConfigFieldKind.SECRET,
            required=True,
        ),
    ),
    docs_url="https://dashboard.cohere.com/api-keys",
)

SnapshotValueT = TypeVar("SnapshotValueT")


class CohereAdapter(ProviderAdapter):
    """Adapter over one configured Cohere API key."""

    provider_type: ClassVar[ProviderType] = ProviderType.COHERE
    descriptor: ClassVar[ProviderDescriptor] = COHERE_DESCRIPTOR

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the Cohere connection secret and bind this adapter."""
        super().__init__(connection)
        self._config = self.parse_config(CohereConnectionConfig, connection.config)

    def _client(self) -> CohereClient:
        """Return the cached Cohere client for this connection."""
        return get_cohere_client(self._config.api_key)

    def validate_connection(self) -> ConnectionValidationResult:
        """Verify the API key against Cohere's authenticated model catalog."""
        try:
            self._client().list_models("chat", force_refresh=True)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403, 498):
                return ConnectionValidationResult(valid=False, message="Invalid Cohere API key.")
            return ConnectionValidationResult(valid=False, message="Cohere validation failed.")
        except httpx.HTTPError:
            return ConnectionValidationResult(valid=False, message="Cohere is unreachable.")
        return ConnectionValidationResult(valid=True, message="Connected.")

    def list_models(
        self, kind: ProviderKind, *, force_refresh: bool = False
    ) -> CatalogResult:
        """List Cohere models filtered by the requested endpoint capability."""
        self.require_kind(kind)
        endpoint = {
            ProviderKind.CHAT: "chat",
            ProviderKind.EMBEDDING: "embed",
            ProviderKind.RERANKING: "rerank",
        }[kind]
        snapshot = self._client().list_models(endpoint, force_refresh=force_refresh)
        input_modalities, output_modalities = _modalities(kind)
        models = [
            CatalogModel(
                connection_id=self.connection.id,
                connection_label=self.connection.label,
                provider_type=self.provider_type,
                id=model.name,
                name=model.name,
                description=model.description,
                context_length=model.context_length,
                max_input_tokens=model.context_length if kind is ProviderKind.EMBEDDING else None,
                dimension=model.output_dimension if kind is ProviderKind.EMBEDDING else None,
                input_modalities=input_modalities,
                output_modalities=output_modalities,
                supported_parameters=_supported_parameters(kind),
            )
            for model in snapshot.value
        ]
        return CatalogResult(models=models, meta=_catalog_metadata(snapshot))

    def embedder(self, model_name: str, dimensions: int | None = None) -> Embedder:
        """Construct a Cohere retrieval embedder."""
        self.require_kind(ProviderKind.EMBEDDING)
        return CohereEmbedder(self._client(), model_name, dimensions=dimensions)

    def chat_provider(self) -> ChatProvider:
        """Construct a Cohere v2 chat provider."""
        self.require_kind(ProviderKind.CHAT)
        return CohereChatProvider(self._client())

    def reranker(self, model_name: str) -> Reranker:
        """Construct a Cohere-backed reranker."""
        self.require_kind(ProviderKind.RERANKING)
        return CohereReranker(self._client(), model_name)

    def embedding_dimension(self, model_name: str) -> int | None:
        """Read catalog metadata or probe Cohere's native embedding dimension."""
        self.require_kind(ProviderKind.EMBEDDING)
        for model in self._client().list_models("embed").value:
            if model.name.casefold() == model_name.casefold():
                if model.output_dimension is not None:
                    return model.output_dimension
                break
        response = self._client().embed(
            ["dimension_probe"],
            model=model_name,
            input_type="search_document",
        )
        if response.embeddings.values:
            return len(response.embeddings.values[0])
        return None

    def embedding_input_limit(self, model_name: str) -> int | None:
        """Read the embedding model context limit from Cohere's catalog."""
        self.require_kind(ProviderKind.EMBEDDING)
        for model in self._client().list_models("embed").value:
            if model.name.casefold() == model_name.casefold():
                return model.context_length
        return None


def _supported_parameters(kind: ProviderKind) -> list[str]:
    """Return the normalized controls exposed for a Cohere model kind."""
    if kind is not ProviderKind.CHAT:
        return []
    return [
        "temperature",
        "top_p",
        "top_k",
        "max_tokens",
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "stop",
        "tools",
    ]


def _modalities(kind: ProviderKind) -> tuple[list[str], list[str]]:
    """Return factual input and output modalities for one Cohere endpoint."""
    output = {
        ProviderKind.CHAT: "text",
        ProviderKind.EMBEDDING: "embedding",
        ProviderKind.RERANKING: "rerank",
    }[kind]
    return ["text"], [output]


def _catalog_metadata(snapshot: CacheSnapshot[SnapshotValueT]) -> CatalogMetadata:
    """Copy shared cache freshness information onto the provider response model."""
    return CatalogMetadata(
        freshness=snapshot.freshness,
        age_seconds=snapshot.age_seconds,
        refreshing=snapshot.refreshing,
        warning=snapshot.warning,
    )
