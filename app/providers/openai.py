"""OpenAI provider adapter."""

from __future__ import annotations

from typing import ClassVar

import httpx

from app.clients.openai_compat import OpenAICompatClient, TransportConfig
from app.db.models import ProviderConnection
from app.providers.base import CatalogResult, ProviderAdapter, ProviderDescriptor
from app.providers.chat.base import ChatProvider
from app.providers.chat.dialects import (
    RESPONSES_PARAMETERS,
    ResponsesProvider,
)
from app.providers.openai_bundle import load_openai_bundle
from app.providers.openai_catalog import CatalogConnection, classify_openai_models
from app.retrieval.embedders.base import Embedder
from app.retrieval.embedders.openai_compat_embedder import OpenAICompatEmbedder
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import ModelInfo
from app.schemas.provider_configs import OpenAIConnectionConfig
from app.schemas.providers import (
    CatalogMetadata,
    ConfigFieldKind,
    ConnectionValidationResult,
    ProviderConfigField,
)

#: OpenAI's canonical API root. A constant rather than a setting: it is not a
#: deployment choice, and a connection that must reach somewhere else already
#: has the per-connection `base_url` override for exactly that.
OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"

OPENAI_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.OPENAI,
    label="OpenAI",
    kinds=(ProviderKind.EMBEDDING, ProviderKind.CHAT),
    config_fields=(
        ProviderConfigField(
            name="api_key",
            label="API key",
            kind=ConfigFieldKind.SECRET,
            required=True,
            placeholder="sk-...",
        ),
        ProviderConfigField(
            name="base_url",
            label="Base URL override",
            kind=ConfigFieldKind.URL,
            required=False,
            advanced=True,
            placeholder="https://api.openai.com/v1",
            description="Set only to route this key through a compatible gateway.",
        ),
    ),
    docs_url="https://platform.openai.com/api-keys",
    recommended=True,
)


class OpenAIAdapter(ProviderAdapter):
    """Adapter over one OpenAI account connection."""

    provider_type: ClassVar[ProviderType] = ProviderType.OPENAI
    descriptor: ClassVar[ProviderDescriptor] = OPENAI_DESCRIPTOR

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the connection config and bind the adapter."""
        super().__init__(connection)
        self._config = self.parse_config(OpenAIConnectionConfig, connection.config)

    def normalized_config(self) -> dict[str, object]:
        """Persist the validated config."""
        return self._config.model_dump(mode="json", exclude_none=True)

    def transport_config(self) -> TransportConfig:
        """Return the endpoint identity this connection's clients are keyed by."""
        return TransportConfig(
            base_url=self._config.base_url or OPENAI_DEFAULT_BASE_URL,
            api_key=self._config.api_key,
        )

    def _client(self) -> OpenAICompatClient:
        """Return the client for this connection's endpoint."""
        from app.clients.openai_compat import get_openai_compat_client

        return get_openai_compat_client(self.transport_config())

    def validate_connection(self) -> ConnectionValidationResult:
        """Validate the key by listing the account's models."""
        try:
            models = self._client().list_model_ids()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                return ConnectionValidationResult(
                    valid=False, message="Invalid OpenAI API key."
                )
            return ConnectionValidationResult(
                valid=False, message="OpenAI validation failed."
            )
        except httpx.HTTPError:
            return ConnectionValidationResult(valid=False, message="OpenAI is unreachable.")
        return ConnectionValidationResult(
            valid=True, message=f"Connected ({len(models)} models)."
        )

    def _chat_parameters(self) -> list[str]:
        """Return the Responses parameter floor.

        OpenAI chat always speaks Responses here: the same model answers the
        two surfaces with different capability profiles (gpt-5.6-luna accepts
        `temperature` on Responses and rejects it on Chat Completions), so a
        per-connection dialect would need two capability answers per model.
        Gateways that only speak Chat Completions use the Custom provider.
        """
        return list(RESPONSES_PARAMETERS)

    def list_models(
        self, kind: ProviderKind, *, force_refresh: bool = False
    ) -> CatalogResult:
        """List the account's models of one kind."""
        del force_refresh
        self.require_kind(kind)
        model_ids = self._client().list_model_ids()
        models = classify_openai_models(
            model_ids,
            kind=kind,
            connection=CatalogConnection(
                id=self.connection.id,
                label=self.connection.label,
                provider_type=self.provider_type,
            ),
            chat_parameters=self._chat_parameters(),
            bundle=load_openai_bundle(),
        )
        return CatalogResult(models=models, meta=CatalogMetadata())

    def _resolve_model(self, model_id: str) -> ModelInfo:
        """Resolve chat-model metadata from the shipped capability bundle.

        The bundle is not the account catalog — `/v1/models` is — so an id it
        has never heard of still resolves, to the full Responses floor and no
        context claim (the chat loop applies its conservative default). A
        model OpenAI ships after the bundle was generated must keep working;
        a retired id fails at inference with OpenAI's own message.
        """
        entry = load_openai_bundle().lookup(model_id)
        if entry is None:
            return ModelInfo(
                id=model_id,
                name=model_id,
                supported_parameters=self._chat_parameters(),
            )
        parameters = [
            p for p in self._chat_parameters() if p != "reasoning" or entry.reasoning
        ]
        return ModelInfo(
            id=model_id,
            name=entry.display_name or model_id,
            context_length=entry.context_window,
            supported_parameters=parameters,
            reasoning_efforts=entry.effort_options() or None,
        )

    def chat_provider(self) -> ChatProvider:
        """Construct the Responses-dialect chat provider."""
        self.require_kind(ProviderKind.CHAT)
        return ResponsesProvider(
            self._client(), name="openai", model_resolver=self._resolve_model
        )

    def embedder(self, model_name: str, dimensions: int | None = None) -> Embedder:
        """Construct an embedder backed by OpenAI's embeddings endpoint."""
        self.require_kind(ProviderKind.EMBEDDING)
        return OpenAICompatEmbedder(
            self._client(), model_name, provider_label="OpenAI", dimensions=dimensions
        )

    def embedding_dimension(self, model_name: str) -> int | None:
        """Measure the model's vector width with a single-input call."""
        self.require_kind(ProviderKind.EMBEDDING)
        return self._client().embedding_dimension(model_name)

    def embedding_input_limit(self, model_name: str) -> int | None:
        """OpenAI publishes no per-model input limit through its API."""
        del model_name
        self.require_kind(ProviderKind.EMBEDDING)
        return None
