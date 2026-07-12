"""Wire-contract validation for retrieval schemas."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.retrieval import CollectionQueryRequest


def test_query_request_rejects_non_positive_top_k() -> None:
    with pytest.raises(ValidationError):
        CollectionQueryRequest(query="q", top_k=0)
    with pytest.raises(ValidationError):
        CollectionQueryRequest(query="q", top_k=-3)


def test_query_request_defaults_top_k_to_five() -> None:
    assert CollectionQueryRequest(query="q").top_k == 5
