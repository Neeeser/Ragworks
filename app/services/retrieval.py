from __future__ import annotations

from typing import List

from pinecone import Pinecone

from app.api.config import get_settings
from app.db.models import Collection
from app.retrieval.embedders.openrouter_embedder import OpenRouterEmbedder
from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig
from app.retrieval.models import QueryRequest
from app.retrieval.retrievers.pinecone_retriever import PineconeRetriever
from app.schemas.retrieval import CollectionQueryResponse, RetrievedChunk
from app.services.openrouter import get_openrouter_client


class RetrievalService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._pinecone = Pinecone(api_key=self.settings.pinecone_api_key)
        self.openrouter = get_openrouter_client()

    def query_collection(self, collection: Collection, query: str, top_k: int = 5) -> CollectionQueryResponse:
        embedder = OpenRouterEmbedder(self.openrouter, collection.embedding_model)
        config = PineconeIndexConfig(
            name=collection.pinecone_index,
            namespace=collection.pinecone_namespace,
            dimension=collection.extra_metadata.get("embedding_dimension", 1536),
            metric="cosine",
        )
        retriever = PineconeRetriever(
            index_config=config,
            embedder=embedder,
            client=self._pinecone,
        )
        request = QueryRequest(text=query, top_k=top_k, namespace=collection.pinecone_namespace)
        response = retriever.retrieve(request)
        chunks: List[RetrievedChunk] = []
        for scored in response.matches:
            chunks.append(
                RetrievedChunk(
                    chunk_id=scored.chunk.chunk_id,
                    document_id=scored.chunk.document_id,
                    score=scored.score,
                    text=scored.chunk.text,
                    metadata=scored.chunk.metadata.data,
                )
            )
        return CollectionQueryResponse(
            query=query,
            top_k=top_k,
            chunks=chunks,
            usage=embedder.usage or {},
        )
