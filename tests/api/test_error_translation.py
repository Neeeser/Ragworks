"""`to_http_exception` maps domain errors (and pinned statuses) to HTTP."""

from __future__ import annotations

from app.api.routes.utils import to_http_exception
from app.services.errors import (
    ExternalServiceError,
    InvalidInputError,
    NotFoundError,
    ServiceError,
)


def test_type_based_mapping():
    """The base type mapping: 404 / 502 / 400."""
    assert to_http_exception(NotFoundError("x")).status_code == 404
    assert to_http_exception(ExternalServiceError("x")).status_code == 502
    assert to_http_exception(InvalidInputError("x")).status_code == 400


def test_pinned_status_wins_over_type():
    """A status pinned on the error overrides the type mapping, detail intact."""
    detail = {"code": "retrieval_pipeline_failed", "message": "boom"}
    exc = ServiceError(detail, status_code=500)
    http = to_http_exception(exc)
    assert http.status_code == 500
    assert http.detail == detail
