"""Consent-gated HuggingFace tokenizer cache routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.routes.utils import to_http_exception
from app.core.config import get_settings
from app.db import models
from app.schemas.tokenizers import HuggingFaceTokenizerDownload, HuggingFaceTokenizerRead
from app.services.errors import ServiceError
from app.services.huggingface_tokenizers import HuggingFaceTokenizerService

router = APIRouter(prefix="/api/tokenizers", tags=["tokenizers"])


@router.post("/huggingface", response_model=HuggingFaceTokenizerRead)
def ensure_huggingface_tokenizer(
    payload: HuggingFaceTokenizerDownload,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> HuggingFaceTokenizerRead:
    """Ensure one tokenizer JSON is cached after checking user consent."""
    try:
        HuggingFaceTokenizerService(session, get_settings().storage_path).ensure_available(
            current_user,
            payload.model_id,
            explicit_consent=payload.consent,
            remember=payload.remember,
        )
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return HuggingFaceTokenizerRead(model_id=payload.model_id)
