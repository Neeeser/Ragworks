"""Pinecone index management API routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import get_current_user
from app.clients.pinecone import IndexDescription, PineconeIndexAdmin, get_pinecone_client
from app.core.config import get_settings
from app.db import models
from app.schemas.pinecone_indexes import (
    PineconeIndex,
    PineconeIndexCreateRequest,
    PineconeIndexDeleteResponse,
    PineconeIndexList,
)

router = APIRouter(prefix="/api/indexes", tags=["indexes"])

settings = get_settings()


def _require_pinecone_key(user: models.User) -> str:
    """Return the user's Pinecone API key or raise an HTTP error."""
    api_key = (user.pinecone_api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pinecone API key is not configured.",
        )
    return api_key


def _get_admin(user: models.User) -> PineconeIndexAdmin:
    """Build a typed Pinecone index admin client for the current user."""
    api_key = _require_pinecone_key(user)
    return PineconeIndexAdmin(get_pinecone_client(api_key))


def _to_wire(description: IndexDescription) -> PineconeIndex:
    """Map the internal typed description onto the stable wire schema."""
    return PineconeIndex.model_validate(description.model_dump())


@router.get("", response_model=PineconeIndexList)
def list_indexes(current_user: models.User = Depends(get_current_user)) -> PineconeIndexList:
    """List Pinecone indexes for the current user."""
    admin = _get_admin(current_user)
    return PineconeIndexList(indexes=[_to_wire(index) for index in admin.list_indexes()])


@router.get("/{index_name}", response_model=PineconeIndex)
def describe_index(
    index_name: str,
    current_user: models.User = Depends(get_current_user),
) -> PineconeIndex:
    """Return details for a specific Pinecone index."""
    admin = _get_admin(current_user)
    try:
        description = admin.describe_index(index_name)
    except Exception as exc:  # pragma: no cover - SDK errors vary by version
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return _to_wire(description)


@router.post("", response_model=PineconeIndex, status_code=status.HTTP_201_CREATED)
def create_index(
    payload: PineconeIndexCreateRequest,
    current_user: models.User = Depends(get_current_user),
) -> PineconeIndex:
    """Create a serverless Pinecone index."""
    admin = _get_admin(current_user)
    description = admin.create_index(
        name=payload.name,
        vector_type=payload.vector_type,
        metric=payload.metric,
        cloud=(payload.cloud or settings.pinecone_cloud).strip(),
        region=(payload.region or settings.pinecone_region).strip(),
        dimension=payload.dimension,
        deletion_protection=payload.deletion_protection,
        tags=payload.tags,
    )
    return _to_wire(description)


@router.delete("/{index_name}", response_model=PineconeIndexDeleteResponse)
def delete_index(
    index_name: str,
    current_user: models.User = Depends(get_current_user),
) -> PineconeIndexDeleteResponse:
    """Delete a Pinecone index by name."""
    admin = _get_admin(current_user)
    admin.delete_index(index_name)
    return PineconeIndexDeleteResponse()
