"""Retrieval service: the legacy collection-query surface over the primary tool.

`query_collection` keeps its historical contract (query + top_k + arguments →
scored chunks) for every caller that predates multi-tool collections — the
search page's legacy endpoint, files search, evals, and chat's no-argument
tool path. It resolves the collection's *primary search tool* and delegates
to `ToolInvocationService`, the single pipeline-invocation path.
"""

# pylint: disable=duplicate-code

from __future__ import annotations

from collections.abc import Mapping

from sqlmodel import Session

from app.db import models
from app.schemas.retrieval import (
    CollectionQueryArgumentsResponse,
    CollectionQueryResponse,
    QueryArgumentRead,
)
from app.services.pipeline_resolution import ResolvedPipeline, resolve_primary_tool
from app.services.tool_invocation import ToolInvocationService


class RetrievalService:
    """Query a collection through its primary search tool."""

    def __init__(self, session: Session) -> None:
        """Initialize retrieval dependencies."""
        self.session = session
        self._invocation = ToolInvocationService(session)

    def query_collection(  # pylint: disable=too-many-arguments,too-many-positional-arguments
        self,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int = 5,
        arguments: Mapping[str, object] | None = None,
    ) -> CollectionQueryResponse:
        """Run a query against a collection's primary tool and return scored chunks.

        `arguments` are the caller-supplied values for the pipeline's declared
        input arguments; invalid values are an `InvalidInputError` (400).
        """
        resolved = self._resolve_pipeline(user, collection)
        result = self._invocation.invoke(
            user, collection, resolved, query, top_k=top_k, arguments=arguments
        )
        return CollectionQueryResponse(
            query=result.query,
            top_k=result.top_k,
            chunks=result.chunks,
            usage=result.usage,
            outputs=result.outputs,
            query_event_id=result.query_event_id,
            pipeline_run_id=result.pipeline_run_id,
        )

    def query_arguments(
        self,
        user: models.User,
        collection: models.Collection,
    ) -> CollectionQueryArgumentsResponse:
        """Return the declared input arguments of the collection's primary tool.

        An empty list means the pipeline declares none — callers fall back to
        the legacy built-in `top_k` control.
        """
        resolved = self._resolve_pipeline(user, collection)
        return CollectionQueryArgumentsResponse(
            arguments=[
                QueryArgumentRead.model_validate(argument.model_dump())
                for argument in resolved.interface.arguments
            ]
        )

    def _resolve_pipeline(
        self,
        user: models.User,
        collection: models.Collection,
    ) -> ResolvedPipeline:
        """Resolve the collection's primary search tool."""
        return resolve_primary_tool(self.session, user, collection)
