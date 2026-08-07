"""Retrieval service: the legacy collection-query surface over the primary tool.

`query_collection` keeps its historical contract (query + top_k + arguments →
scored chunks) for every caller that predates multi-tool collections — the
search page's legacy endpoint, files search, evals, and chat's no-argument
tool path. It resolves the collection's *primary search tool* and delegates
to `ToolInvocationService`, the single pipeline-invocation path.

`store_query_media` is the write half of an image query: a route decodes and
stores the bytes, then queries with the stored reference. Both query
surfaces call it, so the storage layout and the upload contract are stated
once.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Mapping
from uuid import uuid4

from sqlmodel import Session

from app.db import models
from app.pipelines.image_assets import read_image_dimensions
from app.pipelines.model_modalities import accepts_image_queries
from app.pipelines.payloads import MediaAsset
from app.pipelines.registry import default_registry
from app.providers.chat.content import (
    IMAGE_EXTENSION_BY_MEDIA_TYPE,
    SUPPORTED_IMAGE_MEDIA_TYPES,
)
from app.providers.registry import ProviderResolver
from app.schemas.media import QueryMediaPayload
from app.schemas.retrieval import (
    CollectionQueryArgumentsResponse,
    CollectionQueryResponse,
    QueryArgumentRead,
)
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError
from app.services.pipeline_resolution import ResolvedPipeline, resolve_primary_tool
from app.services.tool_invocation import ToolInvocationService
from app.utils.file_storage import FileStorage


def store_query_media(
    collection: models.Collection, payload: QueryMediaPayload
) -> MediaAsset:
    """Persist a query's image and return the stored reference to query with.

    Bytes land under `collections/{id}/queries/` so they purge with the
    collection rather than outliving it. Validation is the upload contract
    — a supported image media type and the configured image size cap —
    reported as input errors, since the user picked the file.
    """
    media_type = payload.media_type.lower()
    if media_type not in SUPPORTED_IMAGE_MEDIA_TYPES:
        raise InvalidInputError(
            f"'{payload.media_type}' is not a supported image type for a query."
        )
    try:
        data = base64.b64decode(payload.data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise InvalidInputError("Query image data is not valid base64.") from exc
    limit_mb = get_app_config().uploads.max_image_upload_size_mb
    if len(data) > limit_mb * 1024 * 1024:
        raise InvalidInputError(
            f"Query image exceeds the configured {limit_mb}MB image limit."
        )
    width, height = read_image_dimensions(data)
    if width is None or height is None:
        raise InvalidInputError("Query image data is not a decodable image.")
    extension = IMAGE_EXTENSION_BY_MEDIA_TYPE[media_type]
    path = f"collections/{collection.id}/queries/{uuid4().hex}{extension}"
    FileStorage().write_bytes(data, path)
    return MediaAsset(
        media_type=media_type,
        path=path,
        byte_size=len(data),
        width=width,
        height=height,
    )


class RetrievalService:
    """Query a collection through its primary search tool."""

    def __init__(self, session: Session) -> None:
        """Initialize retrieval dependencies."""
        self.session = session
        self._invocation = ToolInvocationService(session)

    def query_collection(
        self,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int = 5,
        arguments: Mapping[str, object] | None = None,
        query_media: MediaAsset | None = None,
    ) -> CollectionQueryResponse:
        """Run a query against a collection's primary tool and return scored chunks.

        `arguments` are the caller-supplied values for the pipeline's declared
        input arguments; invalid values are an `InvalidInputError` (400).
        `query_media` is an already-stored image reference (see
        `store_query_media`), so a caller holding stored bytes — the eval
        runner — passes them straight through with no re-encode.
        """
        resolved = self._resolve_pipeline(user, collection)
        result = self._invocation.invoke(
            user,
            collection,
            resolved,
            query,
            top_k=top_k,
            arguments=arguments,
            query_media=query_media,
        )
        return CollectionQueryResponse(
            query=result.query,
            top_k=result.top_k,
            chunks=result.chunks,
            usage=result.usage,
            outputs=result.outputs,
            query_media=result.query_media,
            query_event_id=result.query_event_id,
            pipeline_run_id=result.pipeline_run_id,
        )

    def query_arguments(
        self,
        user: models.User,
        collection: models.Collection,
    ) -> CollectionQueryArgumentsResponse:
        """Describe what the collection's primary tool can be asked with.

        An empty argument list means the pipeline declares none — callers
        fall back to the legacy built-in `top_k` control.
        `accepts_query_media` reports whether the graph can process an image
        query, so a client knows before it offers an attach control.

        Resolution is read-only: a GET must not persist default pipelines
        or bind them to the collection.
        """
        resolved = self._resolve_pipeline(user, collection, scaffold=False)
        return CollectionQueryArgumentsResponse(
            arguments=[
                QueryArgumentRead.model_validate(argument.model_dump())
                for argument in resolved.interface.arguments
            ],
            accepts_query_media=accepts_image_queries(
                resolved.static_definition,
                default_registry(),
                ProviderResolver(user, self.session),
            ),
        )

    def _resolve_pipeline(
        self,
        user: models.User,
        collection: models.Collection,
        *,
        scaffold: bool = True,
    ) -> ResolvedPipeline:
        """Resolve the collection's primary search tool."""
        return resolve_primary_tool(self.session, user, collection, scaffold=scaffold)
