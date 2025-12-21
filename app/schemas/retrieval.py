from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel


class RetrievedChunk(BaseModel):
    chunk_id: str
    document_id: str
    score: float
    text: str
    metadata: Dict[str, Any]


class CollectionQueryRequest(BaseModel):
    query: str
    top_k: int = 5


class CollectionQueryResponse(BaseModel):
    query: str
    top_k: int
    chunks: List[RetrievedChunk]
    usage: Dict[str, Any]
