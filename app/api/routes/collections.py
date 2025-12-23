"""Collection management API routes."""

# pylint: disable=duplicate-code

from __future__ import annotations

from typing import List
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pinecone import Pinecone
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, select

from app.api.config import get_settings
from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.db.repositories import CollectionRepository
from app.schemas.collections import (
    CollectionCreate,
    CollectionDeleteResponse,
    CollectionPromptRead,
    CollectionPromptUpdate,
    CollectionRead,
    CollectionUpdate,
)
from app.services.pipelines import PipelineService
from app.pipelines.config import resolve_ingestion_settings, resolve_retrieval_settings
from app.services.prompts import (
    SYSTEM_PROMPT_METADATA_KEY,
    apply_prompt_template,
    get_system_prompt_template,
    prompt_variables_payload,
    system_prompt_context,
)
from app.api.routes.utils import get_collection_or_404
from app.utils.file_storage import FileStorage
from app.utils.time import utc_now

router = APIRouter(prefix="/api/collections", tags=["collections"])


def _to_schema(collection: models.Collection) -> CollectionRead:
    """Convert a collection model into a response schema."""
    return CollectionRead(
        id=collection.id,
        user_id=collection.user_id,
        name=collection.name,
        description=collection.description,
        ingestion_pipeline_id=collection.ingestion_pipeline_id,
        retrieval_pipeline_id=collection.retrieval_pipeline_id,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        metadata=collection.extra_metadata,
    )


def _prompt_read(  # pylint: disable=too-many-locals
    collection: models.Collection,
    user: models.User,
    session: Session,
) -> CollectionPromptRead:
    """Render prompt data for a collection and user."""
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(user)
    pipeline_service.ensure_collection_pipelines(collection, defaults)
    ingestion_pipeline_id = collection.ingestion_pipeline_id or defaults.ingestion.id
    retrieval_pipeline_id = collection.retrieval_pipeline_id or defaults.retrieval.id
    ingestion_pipeline = pipeline_service.get_pipeline(ingestion_pipeline_id, user.id)
    retrieval_pipeline = pipeline_service.get_pipeline(retrieval_pipeline_id, user.id)
    if not ingestion_pipeline or not retrieval_pipeline:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve pipeline configuration for prompt rendering.",
        )
    ingestion_definition = pipeline_service.get_definition(ingestion_pipeline)
    retrieval_definition = pipeline_service.get_definition(retrieval_pipeline)
    ingestion_settings = resolve_ingestion_settings(ingestion_definition, collection)
    retrieval_settings = resolve_retrieval_settings(retrieval_definition, collection)

    template = get_system_prompt_template(collection)
    context = system_prompt_context(
        collection,
        user,
        ingestion_settings=ingestion_settings,
        retrieval_settings=retrieval_settings,
    )
    rendered = apply_prompt_template(template, context)
    return CollectionPromptRead(
        template=template,
        rendered=rendered,
        context=context,
        variables=prompt_variables_payload(),
    )


@router.get("", response_model=List[CollectionRead])
def list_collections(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[CollectionRead]:
    """List collections owned by the current user."""
    repo = CollectionRepository(session)
    return [_to_schema(col) for col in repo.list_for_user(current_user.id)]


@router.get("/{collection_id}", response_model=CollectionRead)
def get_collection(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Return a collection by id."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    return _to_schema(collection)


@router.get("/{collection_id}/prompt", response_model=CollectionPromptRead)
def get_collection_prompt(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionPromptRead:
    """Return the rendered system prompt for a collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    return _prompt_read(collection, current_user, session)


@router.post("", response_model=CollectionRead, status_code=status.HTTP_201_CREATED)
def create_collection(  # pylint: disable=too-many-locals
    payload: CollectionCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Create a new collection for the current user."""
    repo = CollectionRepository(session)
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(current_user)
    ingestion_pipeline_id = payload.ingestion_pipeline_id or defaults.ingestion.id
    retrieval_pipeline_id = payload.retrieval_pipeline_id or defaults.retrieval.id

    def _validate_pipeline(pipeline_id: UUID, kind: models.PipelineKind) -> models.Pipeline:
        pipeline = pipeline_service.get_pipeline(pipeline_id, current_user.id)
        if not pipeline or pipeline.kind != kind:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid {kind.value} pipeline selection.",
            )
        return pipeline

    ingestion_pipeline = _validate_pipeline(
        ingestion_pipeline_id, models.PipelineKind.INGESTION
    )
    retrieval_pipeline = _validate_pipeline(
        retrieval_pipeline_id, models.PipelineKind.RETRIEVAL
    )

    if payload.pipeline_overrides:
        if payload.pipeline_overrides.ingestion:
            base_definition = pipeline_service.get_definition(ingestion_pipeline)
            override_map = {
                override.node_id: override.config
                for override in payload.pipeline_overrides.ingestion
            }
            next_definition = base_definition.model_copy(deep=True)
            for node in next_definition.nodes:
                if node.id in override_map:
                    node.config = {**node.config, **override_map[node.id]}
            custom_pipeline = pipeline_service.create_pipeline(
                user=current_user,
                name=f"{payload.name} Ingestion Pipeline",
                kind=models.PipelineKind.INGESTION,
                definition=next_definition,
                change_summary="Customized ingestion pipeline for collection.",
                is_default=False,
            )
            ingestion_pipeline_id = custom_pipeline.id
        if payload.pipeline_overrides.retrieval:
            base_definition = pipeline_service.get_definition(retrieval_pipeline)
            override_map = {
                override.node_id: override.config
                for override in payload.pipeline_overrides.retrieval
            }
            next_definition = base_definition.model_copy(deep=True)
            for node in next_definition.nodes:
                if node.id in override_map:
                    node.config = {**node.config, **override_map[node.id]}
            custom_pipeline = pipeline_service.create_pipeline(
                user=current_user,
                name=f"{payload.name} Retrieval Pipeline",
                kind=models.PipelineKind.RETRIEVAL,
                definition=next_definition,
                change_summary="Customized retrieval pipeline for collection.",
                is_default=False,
            )
            retrieval_pipeline_id = custom_pipeline.id

    collection = models.Collection(
        id=uuid4(),
        user_id=current_user.id,
        name=payload.name,
        description=payload.description,
        ingestion_pipeline_id=ingestion_pipeline_id,
        retrieval_pipeline_id=retrieval_pipeline_id,
        extra_metadata=payload.metadata,
    )
    repo.add(collection)
    session.commit()

    session.refresh(collection)
    return _to_schema(collection)


@router.patch("/{collection_id}", response_model=CollectionRead)
def update_collection(  # pylint: disable=too-many-branches
    collection_id: UUID,
    payload: CollectionUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    """Update collection metadata for the current user."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    pipeline_service = PipelineService(session)

    if payload.name is not None:
        collection.name = payload.name
    if payload.description is not None:
        collection.description = payload.description
    if payload.metadata is not None:
        collection.extra_metadata = {**collection.extra_metadata, **payload.metadata}
    if payload.ingestion_pipeline_id is not None:
        if payload.ingestion_pipeline_id:
            pipeline = pipeline_service.get_pipeline(
                payload.ingestion_pipeline_id,
                current_user.id,
            )
            if not pipeline or pipeline.kind != models.PipelineKind.INGESTION:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid ingestion pipeline selection.",
                )
        collection.ingestion_pipeline_id = payload.ingestion_pipeline_id
    if payload.retrieval_pipeline_id is not None:
        if payload.retrieval_pipeline_id:
            pipeline = pipeline_service.get_pipeline(
                payload.retrieval_pipeline_id,
                current_user.id,
            )
            if not pipeline or pipeline.kind != models.PipelineKind.RETRIEVAL:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid retrieval pipeline selection.",
                )
        collection.retrieval_pipeline_id = payload.retrieval_pipeline_id
    collection.updated_at = utc_now()
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return _to_schema(collection)


@router.patch("/{collection_id}/prompt", response_model=CollectionPromptRead)
def update_collection_prompt(
    collection_id: UUID,
    payload: CollectionPromptUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionPromptRead:
    """Update the system prompt template for a collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )

    template_value = (payload.template or "").replace("\r\n", "\n")
    if template_value.strip():
        collection.extra_metadata[SYSTEM_PROMPT_METADATA_KEY] = template_value
    else:
        collection.extra_metadata.pop(SYSTEM_PROMPT_METADATA_KEY, None)
    collection.updated_at = utc_now()
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return _prompt_read(collection, current_user, session)


@router.delete(
    "/{collection_id}",
    response_model=CollectionDeleteResponse,
    status_code=status.HTTP_200_OK,
)
def delete_collection(  # pylint: disable=too-many-locals
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionDeleteResponse:
    """Delete a collection and associated data."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )

    settings = get_settings()
    pinecone_client = Pinecone(api_key=settings.pinecone_api_key)
    storage = FileStorage()
    pipeline_service = PipelineService(session)
    defaults = pipeline_service.ensure_default_pipelines(current_user)
    pipeline_service.ensure_collection_pipelines(collection, defaults)
    ingestion_pipeline_id = collection.ingestion_pipeline_id or defaults.ingestion.id
    ingestion_pipeline = pipeline_service.get_pipeline(ingestion_pipeline_id, current_user.id)
    if not ingestion_pipeline:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve ingestion pipeline for deletion.",
        )
    ingestion_definition = pipeline_service.get_definition(ingestion_pipeline)
    ingestion_settings = resolve_ingestion_settings(ingestion_definition, collection)
    if not ingestion_settings.namespace:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ingestion pipeline namespace is not configured.",
        )

    documents = session.exec(
        select(models.Document).where(models.Document.collection_id == collection.id)
    ).all()
    doc_ids = [doc.id for doc in documents]

    sessions = session.exec(
        select(models.ChatSession).where(models.ChatSession.collection_id == collection.id)
    ).all()
    session_ids = [chat_session.id for chat_session in sessions]

    try:
        index = pinecone_client.Index(ingestion_settings.index_name)
        index.delete(namespace=ingestion_settings.namespace, delete_all=True)
    except Exception as exc:  # pragma: no cover - surfaced via API response
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to purge Pinecone namespace: {exc}",
        ) from exc

    for doc in documents:
        storage.delete_path(doc.source_path)

    session.exec(
        sa_delete(models.DocumentChunkRecord).where(
            models.DocumentChunkRecord.collection_id == collection.id,
        )
    )
    session.exec(
        sa_delete(models.IngestionEvent).where(
            models.IngestionEvent.collection_id == collection.id,
        )
    )
    session.exec(
        sa_delete(models.QueryEvent).where(
            models.QueryEvent.collection_id == collection.id,
        )
    )
    if doc_ids:
        session.exec(
            sa_delete(models.Document).where(
                models.Document.id.in_(doc_ids)  # pylint: disable=no-member
            )
        )
    if session_ids:
        session.exec(
            sa_delete(models.ChatMessage).where(
                models.ChatMessage.session_id.in_(  # pylint: disable=no-member
                    session_ids
                ),
            )
        )
    session.exec(
        sa_delete(models.ChatSession).where(
            models.ChatSession.collection_id == collection.id,
        )
    )

    session.delete(collection)
    session.commit()
    return CollectionDeleteResponse()
