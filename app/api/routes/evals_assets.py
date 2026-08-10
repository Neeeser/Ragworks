"""Serving the bytes an eval dataset's media records reference.

Split from `evals.py`: a dataset's records travel as JSON, while their
images are streamed as files under a different scope root
(`eval_datasets/{id}/`, outside any collection), so the collection asset
route cannot serve them.
"""

from __future__ import annotations

import mimetypes
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.db import models
from app.evals.datasets.media import resolve_dataset_media
from app.evals.service import EvalService
from app.services.errors import ServiceError
from app.utils.file_storage import FileStorage

router = APIRouter(prefix="/api/evals", tags=["evals"])


@router.get("/datasets/{dataset_id}/assets/{asset_path:path}")
def get_dataset_asset(
    dataset_id: UUID,
    asset_path: str,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileResponse:
    """Stream a stored image an eval dataset record references.

    The path is the storage-relative one carried on the record's `media`
    reference; the service scopes it to this dataset's directory, so a
    dataset another user owns and a path outside this one answer alike.
    """
    try:
        EvalService(session).get_dataset(current_user, dataset_id)
        resolved = resolve_dataset_media(FileStorage(), dataset_id, asset_path)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    media_type, _ = mimetypes.guess_type(resolved.name)
    return FileResponse(
        path=resolved,
        media_type=media_type or "application/octet-stream",
        headers={
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff",
        },
    )
