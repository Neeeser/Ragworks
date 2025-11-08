from __future__ import annotations

from datetime import datetime
from typing import List
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pinecone import Pinecone
from sqlalchemy import delete as sa_delete
from sqlmodel import Session, select

from app.api.config import get_settings
from app.api.dependencies import get_current_user, get_session
from app.db import models
from app.db.repositories import CollectionRepository
from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig, PineconeIndexer
from app.schemas.collections import (
    ChunkSettings,
    CollectionCreate,
    CollectionDeleteResponse,
    CollectionRead,
    CollectionUpdate,
)
from app.services.openrouter import get_openrouter_client
from app.utils.file_storage import FileStorage

router = APIRouter(prefix="/api/collections", tags=["collections"])


def _to_schema(collection: models.Collection) -> CollectionRead:
    return CollectionRead(
        id=collection.id,
        user_id=collection.user_id,
        name=collection.name,
        description=collection.description,
        embedding_model=collection.embedding_model,
        chat_model=collection.chat_model,
        pinecone_index=collection.pinecone_index,
        pinecone_namespace=collection.pinecone_namespace,
        context_window=collection.context_window,
        created_at=collection.created_at,
        updated_at=collection.updated_at,
        metadata=collection.extra_metadata,
        chunk_settings=ChunkSettings(
            strategy=collection.chunk_strategy,
            chunk_size=collection.chunk_size,
            chunk_overlap=collection.chunk_overlap,
        ),
    )


@router.get("", response_model=List[CollectionRead])
def list_collections(
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> List[CollectionRead]:
    repo = CollectionRepository(session)
    return [_to_schema(col) for col in repo.list_for_user(current_user.id)]


@router.get("/{collection_id}", response_model=CollectionRead)
def get_collection(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    repo = CollectionRepository(session)
    collection = repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    return _to_schema(collection)


@router.post("", response_model=CollectionRead, status_code=status.HTTP_201_CREATED)
def create_collection(
    payload: CollectionCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    settings = get_settings()
    repo = CollectionRepository(session)
    openrouter = get_openrouter_client()

    embedding_model = payload.embedding_model or settings.default_embedding_model
    chat_model = payload.chat_model or settings.default_chat_model

    embedding_model_info = openrouter.get_model(embedding_model)
    chat_model_info = openrouter.get_model(chat_model)

    chunk_settings = payload.chunk_settings or ChunkSettings()
    chunk_fields_set = getattr(chunk_settings, "model_fields_set", set())
    auto_chunk_size = "chunk_size" not in chunk_fields_set
    chunk_size = chunk_settings.chunk_size
    if auto_chunk_size and embedding_model_info and embedding_model_info.context_length:
        chunk_size = embedding_model_info.context_length
    chunk_overlap = chunk_settings.chunk_overlap
    chunk_strategy = chunk_settings.strategy

    context_window = chat_model_info.context_length if chat_model_info else 8192

    dimension_probe = openrouter.embed(["dimension probe"], model=embedding_model)
    probe_data = dimension_probe.get("data", [])
    if not probe_data:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to probe embedding dimension from OpenRouter.")
    embedding_dimension = len(probe_data[0].get("embedding", []))
    if embedding_dimension == 0:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Embedding dimension returned empty vector.")

    namespace = payload.pinecone_namespace or f"col-{uuid4().hex[:12]}"
    collection = models.Collection(
        id=uuid4(),
        user_id=current_user.id,
        name=payload.name,
        description=payload.description,
        embedding_model=embedding_model,
        chat_model=chat_model,
        context_window=context_window,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        chunk_strategy=chunk_strategy,
        pinecone_index=settings.pinecone_index_name,
        pinecone_namespace=namespace,
        extra_metadata={**payload.metadata, "embedding_dimension": embedding_dimension},
    )
    repo.add(collection)
    session.commit()

    # Ensure Pinecone index exists with the appropriate dimension
    pinecone_client = Pinecone(api_key=settings.pinecone_api_key)
    PineconeIndexer(client=pinecone_client).ensure_index(
        PineconeIndexConfig(
            name=collection.pinecone_index,
            dimension=embedding_dimension,
            metric="cosine",
            cloud=settings.pinecone_cloud,
            region=settings.pinecone_region,
        )
    )

    session.refresh(collection)
    return _to_schema(collection)


@router.patch("/{collection_id}", response_model=CollectionRead)
def update_collection(
    collection_id: UUID,
    payload: CollectionUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionRead:
    repo = CollectionRepository(session)
    collection = repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    if payload.name is not None:
        collection.name = payload.name
    if payload.description is not None:
        collection.description = payload.description
    if payload.metadata is not None:
        collection.extra_metadata.update(payload.metadata)
    if payload.chunk_settings is not None:
        settings_obj = payload.chunk_settings
        fields_set = getattr(settings_obj, "model_fields_set", set())
        if "chunk_size" in fields_set:
            collection.chunk_size = settings_obj.chunk_size
        if "chunk_overlap" in fields_set:
            collection.chunk_overlap = settings_obj.chunk_overlap
        if "strategy" in fields_set:
            collection.chunk_strategy = settings_obj.strategy
    collection.updated_at = datetime.utcnow()
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return _to_schema(collection)


@router.delete(
    "/{collection_id}",
    response_model=CollectionDeleteResponse,
    status_code=status.HTTP_200_OK,
)
def delete_collection(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> CollectionDeleteResponse:
    repo = CollectionRepository(session)
    collection = repo.get(collection_id, user_id=current_user.id)
    if not collection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")

    settings = get_settings()
    pinecone_client = Pinecone(api_key=settings.pinecone_api_key)
    storage = FileStorage()

    documents = session.exec(
        select(models.Document).where(models.Document.collection_id == collection.id)
    ).all()
    doc_ids = [doc.id for doc in documents]

    sessions = session.exec(
        select(models.ChatSession).where(models.ChatSession.collection_id == collection.id)
    ).all()
    session_ids = [chat_session.id for chat_session in sessions]

    try:
        index = pinecone_client.Index(collection.pinecone_index)
        index.delete(namespace=collection.pinecone_namespace, delete_all=True)
    except Exception as exc:  # pragma: no cover - surfaced via API response
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to purge Pinecone namespace: {exc}",
        ) from exc

    for doc in documents:
        storage.delete_path(doc.source_path)

    session.exec(
        sa_delete(models.DocumentChunkRecord).where(models.DocumentChunkRecord.collection_id == collection.id)
    )
    session.exec(sa_delete(models.IngestionEvent).where(models.IngestionEvent.collection_id == collection.id))
    session.exec(sa_delete(models.QueryEvent).where(models.QueryEvent.collection_id == collection.id))
    if doc_ids:
        session.exec(sa_delete(models.Document).where(models.Document.id.in_(doc_ids)))
    if session_ids:
        session.exec(sa_delete(models.ChatMessage).where(models.ChatMessage.session_id.in_(session_ids)))
    session.exec(sa_delete(models.ChatSession).where(models.ChatSession.collection_id == collection.id))

    session.delete(collection)
    session.commit()
    return CollectionDeleteResponse()
