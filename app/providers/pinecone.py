"""Pinecone provider adapter (vector-store credential holder).

Pinecone serves no models — its adapter exists so the credential lives in the
same connections model as every other provider and validates through the same
surface. Vector-store construction itself stays in `app/vectorstores/`, which
reads the key off the user's Pinecone connection.
"""

from __future__ import annotations

from typing import ClassVar

from pinecone.exceptions import PineconeException

from app.clients.pinecone import get_pinecone_client
from app.db.models import ProviderConnection
from app.providers.base import ProviderAdapter, ProviderDescriptor
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import (
    ConfigFieldKind,
    ConnectionValidationResult,
    PineconeConnectionConfig,
    ProviderConfigField,
)

PINECONE_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.PINECONE,
    label="Pinecone",
    kinds=(ProviderKind.VECTOR_STORE,),
    config_fields=(
        ProviderConfigField(
            name="api_key",
            label="API key",
            kind=ConfigFieldKind.SECRET,
            required=True,
            placeholder="pcsk_...",
        ),
    ),
    docs_url="https://app.pinecone.io/-/keys",
    max_connections_per_user=1,
)


class PineconeAdapter(ProviderAdapter):
    """Adapter over one Pinecone project connection."""

    provider_type: ClassVar[ProviderType] = ProviderType.PINECONE
    descriptor: ClassVar[ProviderDescriptor] = PINECONE_DESCRIPTOR

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse the connection config and bind the adapter."""
        super().__init__(connection)
        self._config = self.parse_config(PineconeConnectionConfig, connection.config)

    @property
    def api_key(self) -> str:
        """The validated Pinecone API key (read by the vector-store registry)."""
        return self._config.api_key

    def validate_connection(self) -> ConnectionValidationResult:
        """Validate the API key by listing indexes."""
        try:
            get_pinecone_client(api_key=self._config.api_key).list_indexes()
        except PineconeException:
            return ConnectionValidationResult(valid=False, message="Invalid Pinecone API key.")
        return ConnectionValidationResult(valid=True, message="Connected.")
