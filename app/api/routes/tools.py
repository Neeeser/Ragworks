"""Collection tool endpoints: listing, binding management, and invocation.

`GET /tools` serves each binding's full LLM-facing projection — the same
shape chat advertises to providers and the planned MCP exposure will list.
Binding management (add/update/remove) delegates to `CollectionToolService`,
which owns the primary/enabled/fitness rules. Invocation runs one binding
through `ToolInvocationService`, the single pipeline-invocation path.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.schemas.tools import (
    CollectionToolCreate,
    CollectionToolRead,
    CollectionToolsResponse,
    CollectionToolUpdate,
    ToolInvocationResponse,
    ToolInvokeRequest,
)
from app.services.collection_tools import CollectionToolService
from app.services.errors import ServiceError
from app.services.pipeline_resolution import resolve_tool_binding, resolve_tool_bindings
from app.services.tool_invocation import RetrievalPipelineError, ToolInvocationService
from app.services.tool_projection import to_tool_read

router = APIRouter(prefix="/api/collections", tags=["tools"])


@router.get("/{collection_id}/tools", response_model=CollectionToolsResponse)
def list_collection_tools(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionToolsResponse:
    """List a collection's tool projections and its ingest binding.

    Read-only: an unbound collection lists no tools rather than scaffolding
    defaults (collection creation binds them eagerly; only pre-migration or
    system-provisioned rows can be unbound here).
    """
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        resolved = resolve_tool_bindings(
            session, current_user, collection, enabled_only=False, scaffold=False
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    ingest = CollectionToolService(session).get_ingest_binding(collection)
    return CollectionToolsResponse(
        tools=[to_tool_read(item, collection) for item in resolved],
        ingest_pipeline_id=ingest.pipeline_id if ingest else None,
    )


@router.post(
    "/{collection_id}/tools", response_model=CollectionToolRead, status_code=201
)
def add_collection_tool(
    collection_id: UUID,
    payload: CollectionToolCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionToolRead:
    """Bind a pipeline as one of the collection's tools."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        binding = CollectionToolService(session).add_tool(
            current_user, collection, payload.pipeline_id
        )
        session.commit()
        resolved = resolve_tool_binding(session, current_user, collection, binding.id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return to_tool_read(resolved, collection)


@router.patch(
    "/{collection_id}/tools/{binding_id}", response_model=CollectionToolRead
)
def update_collection_tool(
    collection_id: UUID,
    binding_id: UUID,
    payload: CollectionToolUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionToolRead:
    """Update one tool binding (set primary, enable/disable)."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    service = CollectionToolService(session)
    try:
        if payload.is_primary:
            service.set_primary(current_user, collection, binding_id)
        if payload.enabled is not None:
            service.set_enabled(
                current_user, collection, binding_id, enabled=payload.enabled
            )
        session.commit()
        resolved = resolve_tool_binding(session, current_user, collection, binding_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return to_tool_read(resolved, collection)


@router.delete("/{collection_id}/tools/{binding_id}", status_code=204)
def remove_collection_tool(
    collection_id: UUID,
    binding_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Remove a tool binding from the collection."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        CollectionToolService(session).remove_tool(current_user, collection, binding_id)
        session.commit()
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post(
    "/{collection_id}/tools/{binding_id}/invoke",
    response_model=ToolInvocationResponse,
)
def invoke_collection_tool(
    collection_id: UUID,
    binding_id: UUID,
    payload: ToolInvokeRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ToolInvocationResponse:
    """Run one tool binding with caller-supplied arguments."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return ToolInvocationService(session).invoke_binding(
            current_user,
            collection,
            binding_id,
            payload.query,
            top_k=payload.top_k,
            arguments=payload.arguments,
        )
    except RetrievalPipelineError as exc:
        # Persist the failed run so its trace link resolves (see search.py).
        try:
            session.commit()
        except Exception:  # pylint: disable=broad-exception-caught
            session.rollback()
        raise to_http_exception(exc) from exc
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
