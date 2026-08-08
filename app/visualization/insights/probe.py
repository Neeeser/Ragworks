"""Query probing: vectorize a query in the snapshot's space and rank chunks.

Semantic spaces embed the query through the collection's own retrieval
embedder — the same `(connection, model)` pair its tool pipeline queries
with — so the probe shows what retrieval actually sees. Lexical spaces
vectorize locally through the snapshot's pickled TF-IDF transformer, so a
BM25-only collection probes without any provider call.
"""

from __future__ import annotations

from typing import NamedTuple
from uuid import UUID

import numpy as np
from sqlmodel import Session, col, select

from app.db import models
from app.providers.registry import ProviderResolver
from app.schemas.enums import InsightSpace
from app.schemas.insights import collapse_snippet
from app.services.errors import InvalidInputError
from app.services.pipeline_resolution import resolve_primary_tool
from app.visualization.insights.engine import Array
from app.visualization.insights.service import InsightService

_SNIPPET_CHARS = 200


class ProbeMatch(NamedTuple):
    """A ranked chunk with the display context the panel needs."""

    chunk_id: UUID
    document_id: UUID
    document_name: str
    chunk_index: int
    similarity: float
    text_snippet: str


class ProbeResult(NamedTuple):
    """The query's map position and its nearest chunks."""

    x: float
    y: float
    matches: list[ProbeMatch]


def _semantic_query_vector(
    session: Session,
    user: models.User,
    collection: models.Collection,
    query: str,
) -> Array:
    resolved = resolve_primary_tool(session, user, collection, scaffold=False)
    connection_id = resolved.settings.embedding_connection_id
    model_name = resolved.settings.embedding_model
    if connection_id is None or not model_name:
        raise InvalidInputError(
            "The collection's search tool has no embedder to probe with."
        )
    embedder = ProviderResolver(user, session).embedder(connection_id, model_name)
    return np.asarray(embedder.embed_query(query), dtype=np.float32)


def probe_query(
    session: Session,
    user: models.User,
    collection: models.Collection,
    query: str,
) -> tuple[models.InsightSnapshotRecord, ProbeResult]:
    """Project a query into the collection's insight space and rank chunks."""
    service = InsightService(session)
    snapshot = service.ready_snapshot(collection.id)
    if snapshot.space == InsightSpace.LEXICAL:
        vector = service.lexical_probe_vector(snapshot, query)
    else:
        vector = _semantic_query_vector(session, user, collection, query)
    x, y, ranked = service.probe(snapshot, vector)
    matches = _resolve_matches(session, ranked)
    return snapshot, ProbeResult(x=x, y=y, matches=matches)


def _resolve_matches(session: Session, ranked: list[tuple[UUID, float]]) -> list[ProbeMatch]:
    """Join ranked chunk ids to their display context, preserving order."""
    ids = [chunk_id for chunk_id, _ in ranked]
    if not ids:
        return []
    rows = session.exec(
        select(models.DocumentChunkRecord, col(models.Document.name))
        .join(
            models.Document,
            col(models.DocumentChunkRecord.document_id) == col(models.Document.id),
        )
        .where(col(models.DocumentChunkRecord.id).in_(ids))
    ).all()
    by_id = {chunk.id: (chunk, name) for chunk, name in rows}
    matches: list[ProbeMatch] = []
    for chunk_id, similarity in ranked:
        found = by_id.get(chunk_id)
        if found is None:
            continue
        chunk, name = found
        matches.append(
            ProbeMatch(
                chunk_id=chunk_id,
                document_id=chunk.document_id,
                document_name=name,
                chunk_index=chunk.chunk_index,
                similarity=similarity,
                text_snippet=collapse_snippet(chunk.text[:_SNIPPET_CHARS]),
            )
        )
    return matches
