"""Ragworks retrieval module.

Vector-index access (indexing/querying) lives in `app/vectorstores/`; this
package holds the other pluggable RAG stages: parsers, chunkers, embedders,
and rerankers, plus the shared domain models.
"""

# Keep imports lightweight so provider clients are constructed only by the
# configured adapter when a retrieval stage needs them.

from .chunkers import DocumentChunker
from .embedders import Embedder
from .models import (
    Document,
    DocumentChunk,
    DocumentMetadata,
    QueryRequest,
    RetrievalResponse,
    ScoredChunk,
)
from .parsers import DocumentParser, DocumentSource
from .rerankers import Reranker

__all__ = [
    "Document",
    "DocumentChunk",
    "DocumentChunker",
    "DocumentMetadata",
    "DocumentParser",
    "DocumentSource",
    "Embedder",
    "QueryRequest",
    "Reranker",
    "RetrievalResponse",
    "ScoredChunk",
]
