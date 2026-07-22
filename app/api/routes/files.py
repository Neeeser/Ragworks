"""File-tree API routes: folders, uploads, previews, ingestion, search.

File CRUD and content gate on `get_current_user` only; an OpenRouter key is
required only where embeddings actually run (ingest, content search).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import get_collection_or_404, to_http_exception
from app.db import models
from app.db.repositories import FileNodeRepository
from app.schemas.enums import FileNodeKind
from app.schemas.files import (
    FileCopyRequest,
    FileListingResponse,
    FileNodeRead,
    FileNodeUpdate,
    FileSearchResponse,
    FileTreeResponse,
    FileUploadResponse,
    FolderCreate,
)
from app.services.app_config import get_app_config
from app.services.errors import ServiceError
from app.services.file_copy import FileCopyService
from app.services.file_deletion import FileDeletionService
from app.services.file_search import SEARCH_MODES, FileSearchService
from app.services.files import FileSystemService, UploadSpec
from app.services.ingestion_queue import enqueue_document_ingestion

router = APIRouter(prefix="/api", tags=["files"])


def _upload_form(
    file: UploadFile = File(...),
    parent_id: UUID | None = Form(default=None),
    relative_path: str | None = Form(default=None),
) -> tuple[UploadFile, UploadSpec]:
    """Assemble the multipart upload fields into an `UploadSpec`."""
    return file, UploadSpec(
        filename=file.filename,
        content_type=file.content_type,
        parent_id=parent_id,
        relative_path=relative_path,
    )


def _get_file_or_404(
    file_id: UUID, user_id: UUID, session: Session
) -> models.FileNode:
    """Return a user-owned node or 404 (cross-user access looks identical)."""
    node = FileNodeRepository(session).get_for_user(file_id, user_id)
    if not node:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return node


def _node_collection(node: models.FileNode, session: Session) -> models.Collection:
    """Return the node's collection (the FK guarantees it exists)."""
    collection = session.get(models.Collection, node.collection_id)
    if collection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    return collection


@router.get("/collections/{collection_id}/files/tree", response_model=FileTreeResponse)
def get_file_tree(
    collection_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileTreeResponse:
    """Return the collection's whole file tree in one call."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    return FileSystemService(session).tree(collection)


@router.get("/collections/{collection_id}/files", response_model=FileListingResponse)
def list_folder(
    collection_id: UUID,
    parent_id: UUID | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileListingResponse:
    """Return one folder's children plus its breadcrumb (the `ls` view)."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    try:
        return FileSystemService(session).listing(collection, parent_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post(
    "/collections/{collection_id}/folders",
    response_model=FileNodeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_folder(
    collection_id: UUID,
    payload: FolderCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileNodeRead:
    """Create a folder in the collection's tree."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    service = FileSystemService(session)
    try:
        node = service.create_folder(
            current_user, collection, name=payload.name, parent_id=payload.parent_id
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return service.read_node(node)


@router.post(
    "/collections/{collection_id}/files",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
def upload_file(
    collection_id: UUID,
    background_tasks: BackgroundTasks,
    upload: tuple[UploadFile, UploadSpec] = Depends(_upload_form),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileUploadResponse:
    """Store an upload of any type; queue ingestion when the type is eligible."""
    file, spec = upload
    collection = get_collection_or_404(collection_id, current_user.id, session)
    max_upload_mb = get_app_config().uploads.max_upload_size_mb
    # `UploadFile.size` (Starlette) can be None depending on the transport;
    # the cap is best-effort here and falls through when unavailable.
    if file.size is not None and file.size > max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Upload exceeds the maximum size of {max_upload_mb}MB.",
        )
    service = FileSystemService(session)
    try:
        result = service.register_upload(current_user, collection, spec, file.file)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    if result.document is not None:
        background_tasks.add_task(enqueue_document_ingestion, result.document.id)
    tree_paths = service.read_node(result.file)
    return FileUploadResponse(
        file=tree_paths,
        created_folders=[service.read_node(folder) for folder in result.created_folders],
    )


@router.patch("/files/{file_id}", response_model=FileNodeRead)
def update_file_node(
    file_id: UUID,
    payload: FileNodeUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileNodeRead:
    """Rename and/or move a file or folder."""
    node = _get_file_or_404(file_id, current_user.id, session)
    service = FileSystemService(session)
    try:
        node = service.update_node(node, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return service.read_node(node)


@router.post(
    "/files/{file_id}/copy",
    response_model=FileNodeRead,
    status_code=status.HTTP_201_CREATED,
)
def copy_file_node(
    file_id: UUID,
    payload: FileCopyRequest,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileNodeRead:
    """Copy a file or folder subtree; the copy re-ingests like a fresh upload."""
    node = _get_file_or_404(file_id, current_user.id, session)
    collection = _node_collection(node, session)
    try:
        result = FileCopyService(session).copy(
            current_user, collection, node, target_parent_id=payload.parent_id
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    for document in result.documents:
        background_tasks.add_task(enqueue_document_ingestion, document.id)
    return FileSystemService(session).read_node(result.root)


@router.delete("/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file_node(
    file_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Delete a file, or a folder and its whole subtree."""
    node = _get_file_or_404(file_id, current_user.id, session)
    collection = _node_collection(node, session)
    try:
        FileDeletionService(session).delete(current_user, collection, node)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/files/{file_id}/content")
def get_file_content(
    file_id: UUID,
    disposition: str = Query(default="inline", pattern="^(inline|attachment)$"),
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileResponse:
    """Stream a file's stored bytes for preview or download."""
    node = _get_file_or_404(file_id, current_user.id, session)
    if node.kind != FileNodeKind.FILE or not node.storage_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="File has no stored content"
        )
    return FileResponse(
        path=node.storage_path,
        media_type=node.content_type or "application/octet-stream",
        headers={
            "Content-Disposition": f'{disposition}; filename="{node.name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/files/{file_id}/ingest",
    response_model=FileNodeRead,
    status_code=status.HTTP_202_ACCEPTED,
)
def ingest_file(
    file_id: UUID,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileNodeRead:
    """(Re)queue ingestion for a file — the retry / attempt-anyway path."""
    node = _get_file_or_404(file_id, current_user.id, session)
    if node.kind != FileNodeKind.FILE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Folders cannot be ingested."
        )
    collection = _node_collection(node, session)
    service = FileSystemService(session)
    try:
        document = service.ensure_pending_document(current_user, collection, node)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    session.commit()
    background_tasks.add_task(enqueue_document_ingestion, document.id)
    return service.read_node(node)


@router.get("/collections/{collection_id}/files/search", response_model=FileSearchResponse)
def search_files(
    collection_id: UUID,
    q: str,
    modes: str | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileSearchResponse:
    """Search the tree by file name, folder name, and/or indexed content."""
    collection = get_collection_or_404(collection_id, current_user.id, session)
    requested = (
        frozenset(part.strip() for part in modes.split(",") if part.strip())
        if modes
        else SEARCH_MODES
    )
    invalid = requested - SEARCH_MODES
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown search modes: {', '.join(sorted(invalid))}.",
        )
    try:
        return FileSearchService(session).search(
            current_user, collection, query=q, modes=requested
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
