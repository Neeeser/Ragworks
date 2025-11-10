from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.db.models import ChunkStrategy
from app.schemas.base import DateTimeConfigMixin


class ChunkSettings(BaseModel):
    strategy: ChunkStrategy = Field(default=ChunkStrategy.TOKEN)
    chunk_size: int = Field(default=1024, gt=0)
    chunk_overlap: int = Field(default=200, ge=0)


class CollectionBase(BaseModel):
    name: str
    description: Optional[str] = None
    embedding_model: Optional[str] = None
    chat_model: Optional[str] = None
    chunk_settings: ChunkSettings = Field(default_factory=ChunkSettings)
    pinecone_namespace: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class CollectionCreate(CollectionBase):
    pass


class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    chunk_settings: Optional[ChunkSettings] = None
    metadata: Optional[Dict[str, Any]] = None


class CollectionRead(DateTimeConfigMixin, CollectionBase):
    id: UUID
    user_id: UUID
    pinecone_index: str
    context_window: int
    created_at: datetime
    updated_at: datetime


class CollectionDeleteResponse(BaseModel):
    status: str = "deleted"


class PromptVariable(BaseModel):
    name: str
    description: str
    example: Optional[str] = None


class CollectionPromptRead(BaseModel):
    template: str
    rendered: str
    context: Dict[str, str]
    variables: List[PromptVariable]
    is_custom: bool = False


class CollectionPromptUpdate(BaseModel):
    template: Optional[str] = None
