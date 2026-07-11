"""Search across a collection's file tree: names, folders, and content.

Name/folder modes are simple case-insensitive containment over the tree
(the frontend also computes these client-side for instant feedback; this
endpoint exists for parity and for future model-facing tools). Content mode
runs the collection's real retrieval pipeline and maps scored chunks back to
their files via `documents.file_id`.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import DocumentRepository
from app.schemas.enums import FileNodeKind
from app.schemas.files import FileContentMatch, FileNodeRead, FileSearchResponse
from app.services.files import FileSystemService
from app.services.retrieval import RetrievalService

SEARCH_MODES = frozenset({"name", "folder", "content"})
_SNIPPET_LENGTH = 240


class FileSearchService:
    """Grouped search over one collection's files."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.files = FileSystemService(session)

    def search(
        self,
        user: models.User,
        collection: models.Collection,
        *,
        query: str,
        modes: frozenset[str] = SEARCH_MODES,
        top_k: int = 8,
    ) -> FileSearchResponse:
        """Return grouped matches for the requested modes."""
        tree = self.files.tree(collection)
        needle = query.strip().lower()
        folders: list[FileNodeRead] = []
        files: list[FileNodeRead] = []
        if needle:
            for node in tree.nodes:
                if needle not in node.name.lower():
                    continue
                if node.kind == FileNodeKind.FOLDER and "folder" in modes:
                    folders.append(node)
                elif node.kind == FileNodeKind.FILE and "name" in modes:
                    files.append(node)
        content: list[FileContentMatch] = []
        if needle and "content" in modes:
            content = self._content_matches(user, collection, query, top_k, tree.nodes)
        return FileSearchResponse(query=query, folders=folders, files=files, content=content)

    def _content_matches(
        self,
        user: models.User,
        collection: models.Collection,
        query: str,
        top_k: int,
        nodes: list[FileNodeRead],
    ) -> list[FileContentMatch]:
        """Run the retrieval pipeline and map chunk hits back onto files."""
        response = RetrievalService(self.session).query_collection(
            user, collection, query, top_k=top_k
        )
        nodes_by_id = {str(node.id): node for node in nodes}
        documents = DocumentRepository(self.session)
        matches: list[FileContentMatch] = []
        for chunk in response.chunks:
            file_node = None
            document_id = _parse_uuid(chunk.document_id)
            document = documents.get(document_id) if document_id else None
            if document is not None and document.file_id is not None:
                file_node = nodes_by_id.get(str(document.file_id))
            matches.append(
                FileContentMatch(
                    file=file_node,
                    document_id=chunk.document_id,
                    chunk_id=chunk.chunk_id,
                    snippet=chunk.text[:_SNIPPET_LENGTH],
                    score=chunk.score,
                )
            )
        return matches


def _parse_uuid(value: str) -> UUID | None:
    """Parse a chunk's document id, tolerating non-UUID legacy ids."""
    try:
        return UUID(value)
    except ValueError:
        return None
