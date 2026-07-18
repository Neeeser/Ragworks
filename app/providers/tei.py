"""Hugging Face Text Embeddings Inference provider adapter."""

from __future__ import annotations

from typing import ClassVar

import httpx

from app.clients.tei import TEIClient, TEIInfo, get_tei_client
from app.db.models import ProviderConnection
from app.providers.base import CatalogResult, ProviderAdapter, ProviderDescriptor
from app.retrieval.embedders.base import Embedder
from app.retrieval.embedders.tei_embedder import TEIEmbedder
from app.retrieval.rerankers.base import Reranker
from app.retrieval.rerankers.tei import TEIReranker
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import (
    CatalogMetadata,
    CatalogModel,
    ConfigFieldKind,
    ConnectionValidationResult,
    ProviderConfigField,
    TEIConnectionConfig,
)
from app.services.errors import InvalidInputError

TEI_DESCRIPTOR = ProviderDescriptor(
    provider_type=ProviderType.TEI,
    label="Hugging Face TEI",
    # A live connection exposes only one of these. These potential kinds allow
    # the connection form to render before its first successful `/info` probe.
    kinds=(ProviderKind.EMBEDDING, ProviderKind.RERANKING),
    config_fields=(
        ProviderConfigField(
            name="base_url",
            label="Server URL",
            kind=ConfigFieldKind.URL,
            required=True,
            placeholder="http://localhost:8080",
            description="Each TEI connection serves one model and task.",
        ),
        ProviderConfigField(
            name="api_key",
            label="API key (optional, for proxied servers)",
            kind=ConfigFieldKind.SECRET,
            required=False,
        ),
    ),
    docs_url="https://huggingface.co/docs/text-embeddings-inference",
)


def _kind_for_info(info: TEIInfo) -> ProviderKind:
    """Map TEI's tagged model-type union to the supported Ragworks kind."""
    keys = tuple(info.model_type)
    if keys == ("embedding",):
        return ProviderKind.EMBEDDING
    if keys == ("reranker",):
        return ProviderKind.RERANKING
    rendered = ", ".join(keys) or "empty"
    raise InvalidInputError(
        "The TEI server reports an unsupported model_type "
        f"({rendered}). Only embedding and reranker models are supported."
    )


class TEIAdapter(ProviderAdapter):
    """Adapter over one TEI server that serves exactly one model and task."""

    provider_type: ClassVar[ProviderType] = ProviderType.TEI
    descriptor: ClassVar[ProviderDescriptor] = TEI_DESCRIPTOR

    def __init__(self, connection: ProviderConnection) -> None:
        """Parse stored connection configuration and defer the live `/info` probe."""
        super().__init__(connection)
        self._config = self.parse_config(TEIConnectionConfig, connection.config)
        self._cached_info: TEIInfo | None = None

    def _client(self) -> TEIClient:
        """Return the shared client for this server configuration."""
        return get_tei_client(self._config.base_url, self._config.api_key)

    def _info(self, force_refresh: bool = False) -> TEIInfo:
        """Return this adapter's served-model metadata, caching it for its lifetime."""
        if force_refresh or self._cached_info is None:
            self._cached_info = self._client().info()
        return self._cached_info

    @property
    def kinds(self) -> tuple[ProviderKind, ...]:
        """Return the one capability advertised by the currently served TEI model."""
        return (_kind_for_info(self._info()),)

    def validate_connection(self) -> ConnectionValidationResult:
        """Validate server reachability, auth, and its supported served task."""
        try:
            info = self._info(force_refresh=True)
            kind = _kind_for_info(info)
        except InvalidInputError as exc:
            return ConnectionValidationResult(valid=False, message=str(exc))
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in (401, 403):
                return ConnectionValidationResult(
                    valid=False, message="The TEI server rejected the API key."
                )
            return ConnectionValidationResult(valid=False, message="TEI validation failed.")
        except httpx.HTTPError:
            return ConnectionValidationResult(
                valid=False,
                message="The TEI server is unreachable. Check the URL and that it is running.",
            )
        return ConnectionValidationResult(
            valid=True, message=f"Connected ({info.model_id}, {kind.value})."
        )

    def list_models(
        self, kind: ProviderKind, *, force_refresh: bool = False
    ) -> CatalogResult:
        """Return TEI's one served model only when its task matches ``kind``."""
        info = self._info(force_refresh)
        served_kind = _kind_for_info(info)
        if kind is not served_kind:
            raise InvalidInputError(
                f"This TEI server does not serve {kind.value} models; "
                f"it serves a {served_kind.value} model."
            )
        return CatalogResult(
            models=[
                CatalogModel(
                    connection_id=self.connection.id,
                    connection_label=self.connection.label,
                    provider_type=self.provider_type,
                    id=info.model_id,
                    name=info.model_id,
                    max_input_tokens=info.max_input_length,
                    input_modalities=["text"],
                    output_modalities=(
                        ["embedding"]
                        if served_kind is ProviderKind.EMBEDDING
                        else ["rerank"]
                    ),
                )
            ],
            meta=CatalogMetadata(),
        )

    def _require_served_model(self, model_name: str, kind: ProviderKind) -> TEIInfo:
        """Reject stale model selections and task mismatches before inference."""
        self.require_kind(kind)
        info = self._info()
        if model_name != info.model_id:
            raise InvalidInputError(
                f"This TEI server serves '{info.model_id}', not '{model_name}'."
            )
        return info

    def embedder(self, model_name: str, dimensions: int | None = None) -> Embedder:
        """Construct an embedder when TEI serves the requested embedding model."""
        del dimensions
        self._require_served_model(model_name, ProviderKind.EMBEDDING)
        return TEIEmbedder(self._client(), model_name)

    def reranker(self, model_name: str) -> Reranker:
        """Construct a reranker when TEI serves the requested reranking model."""
        self._require_served_model(model_name, ProviderKind.RERANKING)
        return TEIReranker(self._client(), model_name)

    def embedding_dimension(self, model_name: str) -> int | None:
        """Measure the served embedding dimension because `/info` does not publish it."""
        self._require_served_model(model_name, ProviderKind.EMBEDDING)
        vectors = self._client().embed(["dimension_probe"])
        return len(vectors[0]) if vectors else None

    def embedding_input_limit(self, model_name: str) -> int | None:
        """Return the served embedding model's published TEI input limit."""
        return self._require_served_model(
            model_name, ProviderKind.EMBEDDING
        ).max_input_length
