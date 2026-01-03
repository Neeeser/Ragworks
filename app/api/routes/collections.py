"""Collection management API routes."""

# pylint: disable=duplicate-code

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Tuple
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete as sa_delete, func
from sqlmodel import Session, select

from app.api.dependencies import get_session, require_user_api_keys
from app.db import models
from app.db.repositories import CollectionRepository
from app.schemas.collections import (
    CollectionCreate,
    CollectionDeleteResponse,
    CollectionPromptRead,
    CollectionPromptUpdate,
    CollectionRead,
    CollectionStatsRead,
    CollectionUpdate,
)
from app.services.pipelines import PipelineService
from app.pipelines.config import resolve_ingestion_settings, resolve_retrieval_settings
from app.retrieval.pinecone import get_pinecone_client
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


def _is_missing_pinecone_namespace(error: Exception) -> bool:
    """Return True when the Pinecone delete error indicates a missing namespace."""
    message = str(error).lower()
    if "namespace not found" in message:
        return True
    status_code = getattr(error, "status_code", None) or getattr(error, "status", None)
    if status_code == 404 and "namespace" in message:
        return True
    response = getattr(error, "response", None)
    response_status = getattr(response, "status_code", None) if response else None
    return response_status == 404 and "namespace" in message


def _build_collection_stats(
    session: Session,
    user_id: UUID,
    collection_ids: List[UUID],
) -> Dict[UUID, CollectionStatsRead]:
    """Return aggregated stats for the given collections."""
    if not collection_ids:
        return {}
    doc_rows: List[Tuple[UUID, int, int]] = session.exec(  # pylint: disable=not-callable
        select(
            models.Document.collection_id,
            func.count(models.Document.id),  # pylint: disable=not-callable
            func.coalesce(func.sum(models.Document.num_chunks), 0),
        ).where(
            models.Document.user_id == user_id,
            models.Document.collection_id.in_(collection_ids),  # pylint: disable=no-member
        ).group_by(models.Document.collection_id)
    ).all()
    doc_map = {row[0]: (int(row[1]), int(row[2])) for row in doc_rows}

    query_rows: List[Tuple[UUID, Optional[float], Optional[datetime]]] = session.exec(
        select(
            models.QueryEvent.collection_id,
            func.avg(models.QueryEvent.latency_ms),
            func.max(models.QueryEvent.created_at),
        ).where(
            models.QueryEvent.user_id == user_id,
            models.QueryEvent.collection_id.in_(collection_ids),  # pylint: disable=no-member
        ).group_by(models.QueryEvent.collection_id)
    ).all()
    query_map = {row[0]: (row[1], row[2]) for row in query_rows}

    stats: Dict[UUID, CollectionStatsRead] = {}
    for collection_id in collection_ids:
        doc_count, chunk_count = doc_map.get(collection_id, (0, 0))
        avg_latency, last_used = query_map.get(collection_id, (None, None))
        stats[collection_id] = CollectionStatsRead(
            collection_id=collection_id,
            document_count=doc_count,
            chunk_count=chunk_count,
            average_latency_ms=float(avg_latency) if avg_latency is not None else None,
            last_used_at=last_used,
        )
    return stats


@router.get("", response_model=List[CollectionRead])
def list_collections(
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> List[CollectionRead]:
    """List collections owned by the current user."""
    repo = CollectionRepository(session)
    return [_to_schema(col) for col in repo.list_for_user(current_user.id)]


@router.get("/stats", response_model=List[CollectionStatsRead])
def list_collection_stats(
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> List[CollectionStatsRead]:
    """Return aggregated stats for all collections."""
    repo = CollectionRepository(session)
    collections = list(repo.list_for_user(current_user.id))
    stats_map = _build_collection_stats(
        session,
        current_user.id,
        [collection.id for collection in collections],
    )
    return [stats_map[collection.id] for collection in collections]


@router.get("/{collection_id}/stats", response_model=CollectionStatsRead)
def get_collection_stats(
    collection_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> CollectionStatsRead:
    """Return aggregated stats for a single collection."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )
    stats_map = _build_collection_stats(session, current_user.id, [collection.id])
    return stats_map[collection.id]


@router.get("/{collection_id}", response_model=CollectionRead)
def get_collection(
    collection_id: UUID,
    current_user: models.User = Depends(require_user_api_keys),
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
    current_user: models.User = Depends(require_user_api_keys),
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
    current_user: models.User = Depends(require_user_api_keys),
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
            ingestion_pipeline = custom_pipeline
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
            retrieval_pipeline = custom_pipeline

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
    current_user: models.User = Depends(require_user_api_keys),
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
    current_user: models.User = Depends(require_user_api_keys),
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
    current_user: models.User = Depends(require_user_api_keys),
    session: Session = Depends(get_session),
) -> CollectionDeleteResponse:
    """Delete a collection and associated data."""
    collection = get_collection_or_404(
        collection_id=collection_id,
        user_id=current_user.id,
        session=session,
    )

    pinecone_client = get_pinecone_client(api_key=current_user.pinecone_api_key)
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
    except Exception as exc:  # pragma: no cover - surfaced via API response  # pylint: disable=broad-exception-caught
        if not _is_missing_pinecone_namespace(exc):
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
    run_ids = session.exec(
        select(models.PipelineRun.id).where(
            models.PipelineRun.collection_id == collection.id,
        )
    ).all()
    if run_ids:
        session.exec(
            sa_delete(models.PipelineNodeIO).where(
                models.PipelineNodeIO.run_id.in_(  # pylint: disable=no-member
                    run_ids
                )
            )
        )
        session.exec(
            sa_delete(models.PipelineNodeRun).where(
                models.PipelineNodeRun.run_id.in_(  # pylint: disable=no-member
                    run_ids
                )
            )
        )
        session.exec(
            sa_delete(models.PipelineRun).where(
                models.PipelineRun.id.in_(run_ids)  # pylint: disable=no-member
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
