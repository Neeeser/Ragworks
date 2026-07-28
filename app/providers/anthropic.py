"""Anthropic provider adapter."""

from __future__ import annotations

from typing import ClassVar

import anthropic

from app.clients.anthropic import AnthropicClient, get_anthropic_client
from app.db.models import ProviderConnection
from app.providers.base import CatalogResult, ProviderAdapter, ProviderDescriptor
from app.providers.chat.base import ChatProvider
from app.providers.chat.dialects import MessagesProvider
from app.providers.chat.dialects.messages import model_info_from_catalog
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.provider_configs import (
    AnthropicConnectionConfig,
)
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConfigFieldKind,
    ConnectionValidationResult,
    ProviderConfigField,
)

ANTHROPIC_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.ANTHROPIC,
    label="Anthropic",
    # Chat only: Anthropic ships no embedding or reranking models, and
    # advertising kinds it cannot serve would let a user pick this connection
    # in a picker that can never resolve.
    kinds=(ProviderKind.CHAT,),
    config_fields=(
        ProviderConfigField(
            name="api_key",
            label="API key",
            kind=ConfigFieldKind.SECRET,
            required=True,
            placeholder="sk-ant-...",
        ),
        ProviderConfigField(
            name="base_url",
            label="Base URL override",
            kind=ConfigFieldKind.URL,
            required=False,
            advanced=True,
            placeholder="https://api.anthropic.com",
            description="Set only to route this key through a compatible gateway.",
        ),
    ),
    docs_url="https://console.anthropic.com/settings/keys",
    recommended=True,
)


class AnthropicAdapter(ProviderAdapter):
    """Adapter over one Anthropic account connection."""

    provider_type: ClassVar[ProviderType] = ProviderType.ANTHROPIC
    descriptor: ClassVar[ProviderDescriptor] = ANTHROPIC_DESCRIPTOR

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the connection config and bind the adapter."""
        super().__init__(connection)
        self._config = self.parse_config(AnthropicConnectionConfig, connection.config)

    def normalized_config(self) -> dict[str, object]:
        """Persist the validated config, dropping an unset base URL."""
        return self._config.model_dump(mode="json", exclude_none=True)

    def _client(self) -> AnthropicClient:
        """Return the cached client for this credential."""
        return get_anthropic_client(self._config.api_key, self._config.base_url)

    def validate_connection(self) -> ConnectionValidationResult:
        """Validate the key by listing the account's models."""
        try:
            models = self._client().list_models(force_refresh=True).value
        except anthropic.AuthenticationError:
            return ConnectionValidationResult(
                valid=False, message="Invalid Anthropic API key."
            )
        except anthropic.PermissionDeniedError:
            return ConnectionValidationResult(
                valid=False, message="This Anthropic key lacks model access."
            )
        except anthropic.APIConnectionError:
            return ConnectionValidationResult(
                valid=False, message="Anthropic is unreachable."
            )
        except anthropic.APIStatusError:
            return ConnectionValidationResult(
                valid=False, message="Anthropic validation failed."
            )
        return ConnectionValidationResult(
            valid=True, message=f"Connected ({len(models)} models)."
        )

    def list_models(
        self, kind: ProviderKind, *, force_refresh: bool = False
    ) -> CatalogResult:
        """List the account's chat models with their published capabilities."""
        self.require_kind(kind)
        snapshot = self._client().list_models(force_refresh=force_refresh)
        models = []
        for entry in snapshot.value:
            info = model_info_from_catalog(entry)
            models.append(
                CatalogModel(
                    connection_id=self.connection.id,
                    connection_label=self.connection.label,
                    provider_type=self.provider_type,
                    id=info.id,
                    name=info.name,
                    context_length=info.context_length,
                    input_modalities=["text"],
                    output_modalities=["text"],
                    supported_parameters=info.supported_parameters,
                )
            )
        return CatalogResult(
            models=models,
            meta=CatalogMetadata(
                freshness=snapshot.freshness,
                age_seconds=snapshot.age_seconds,
                refreshing=snapshot.refreshing,
                warning=snapshot.warning,
            ),
        )

    def chat_provider(self) -> ChatProvider:
        """Construct the Messages-dialect chat provider for this connection."""
        self.require_kind(ProviderKind.CHAT)
        return MessagesProvider(self._client())
