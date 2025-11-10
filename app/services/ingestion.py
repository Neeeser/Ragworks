from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import UploadFile
from pinecone import Pinecone
from sqlmodel import Session

from app.api.config import get_settings
from app.db import models
from app.db.repositories import ChunkRepository
from app.retrieval.embedders.openrouter_embedder import OpenRouterEmbedder
from app.retrieval.indexers.pinecone_indexer import PineconeIndexConfig, PineconeIndexer
from app.retrieval.indexing import DocumentIndexer
from app.retrieval.models import Document as RetrievalDocument
from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers.base import DocumentSource
from app.retrieval.parsers.pdf import PdfToTextParser
from app.retrieval.parsers.txt import TxtDocumentParser
from app.services.chunking import build_chunker
from app.services.openrouter import get_openrouter_client
from app.utils.file_storage import FileStorage
from app.utils.time import utc_now

logger = logging.getLogger(__name__)


class IngestionService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()
        self.storage = FileStorage()
        self.openrouter = get_openrouter_client()
        self._pinecone = Pinecone(api_key=self.settings.pinecone_api_key)
        self._indexer = PineconeIndexer(client=self._pinecone)
        self.chunks = ChunkRepository(session)

    def _select_parser(self, content_type: str) -> object:
        if "pdf" in (content_type or ""):
            return PdfToTextParser()
        return TxtDocumentParser()

    def _build_metadata(self, document: models.Document) -> DocumentMetadata:
        return DocumentMetadata(
            data={
                "collection_id": str(document.collection_id),
                "document_id": str(document.id),
                "filename": document.name,
            }
        )

    def ingest_upload(self, *, user: models.User, collection: models.Collection, upload: UploadFile) -> Dict[str, object]:
        document = models.Document(
            collection_id=collection.id,
            user_id=user.id,
            name=upload.filename or "uploaded-document",
            content_type=upload.content_type or "text/plain",
            status=models.DocumentStatus.PROCESSING,
            chunk_size=collection.chunk_size,
            chunk_overlap=collection.chunk_overlap,
            chunk_strategy=collection.chunk_strategy,
            embedding_model=collection.embedding_model,
        )
        self.session.add(document)
        self.session.flush()

        relative_path = f"collections/{collection.id}/documents/{document.id}/{document.name}"
        path = self.storage.save_upload(upload, relative_path)

        try:
            parser = self._select_parser(document.content_type)
            logger.info(
                "Selected parser %s for document %s (%s)",
                parser.__class__.__name__,
                document.id,
                document.content_type,
            )
            source = DocumentSource(
                document_id=str(document.id),
                path=Path(path),
                content_type=document.content_type,
                metadata=self._build_metadata(document),
            )
            parsed: RetrievalDocument = parser.parse(source)  # type: ignore[assignment]
            parsed_text = (parsed.text or "").strip()
            snippet = (parsed_text[:200] + ("..." if len(parsed_text) > 200 else "")) if parsed_text else ""
            logger.info(
                "Parsed uploaded document %s (%s) content_type=%s chars=%s snippet=%r",
                document.id,
                document.name,
                document.content_type,
                len(parsed_text),
                snippet,
            )
            chunker = build_chunker(collection.chunk_strategy, collection.chunk_size, collection.chunk_overlap)
            logger.info(
                "Constructed chunker=%s strategy=%s size=%s overlap=%s for document %s",
                chunker.__class__.__name__,
                collection.chunk_strategy,
                collection.chunk_size,
                collection.chunk_overlap,
                document.id,
            )
            embedder = OpenRouterEmbedder(self.openrouter, collection.embedding_model)
            index_config = PineconeIndexConfig(
                name=collection.pinecone_index,
                namespace=collection.pinecone_namespace,
                dimension=collection.extra_metadata.get("embedding_dimension", 1536),
                metric="cosine",
            )
            indexer = DocumentIndexer(
                chunker=chunker,
                embedder=embedder,
                indexer=self._indexer,
                index_config=index_config,
            )
            indexer.ensure_index()
            enriched_chunks = indexer.index_document(document=parsed, namespace=collection.pinecone_namespace)

            chunk_records: List[models.DocumentChunkRecord] = []
            for chunk in enriched_chunks:
                chunk_records.append(
                    models.DocumentChunkRecord(
                        document_id=document.id,
                        collection_id=collection.id,
                        chunk_index=chunk.order,
                        text=chunk.text,
                        embedding=chunk.embedding or [],
                        chunk_metadata=chunk.metadata.data,
                        chunk_size=collection.chunk_size,
                        chunk_overlap=collection.chunk_overlap,
                        chunk_strategy=collection.chunk_strategy,
                        embedding_model=collection.embedding_model,
                    )
                )
            self.chunks.add_many(chunk_records)

            document.status = models.DocumentStatus.READY
            document.num_chunks = len(chunk_records)
            document.num_tokens = sum(len(chunk.text.split()) for chunk in enriched_chunks)
            document.source_path = str(path)
            document.updated_at = utc_now()
            usage = embedder.usage or {}
            self.session.add(models.IngestionEvent(
                document_id=document.id,
                collection_id=collection.id,
                event_type="ingestion_complete",
                status="success",
                details={
                    "chunks": len(chunk_records),
                    "embedding_model": collection.embedding_model,
                    "usage": usage,
                },
            ))
            self.session.commit()

            return {
                "document": document,
                "chunk_count": len(chunk_records),
                "pinecone_namespace": collection.pinecone_namespace,
                "embedding_model": collection.embedding_model,
                "usage": usage,
            }
        except Exception as exc:
            document.status = models.DocumentStatus.FAILED
            document.updated_at = utc_now()
            self.session.add(models.IngestionEvent(
                document_id=document.id,
                collection_id=collection.id,
                event_type="ingestion_failed",
                status="error",
                details={"error": str(exc)},
            ))
            self.session.commit()
            raise
