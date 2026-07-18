"""Behavior tests for TEI provider capability detection."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.clients.tei.schemas import TEIInfo
from app.db import models
from app.providers.tei import TEIAdapter
from app.schemas.enums import ProviderKind, ProviderType
from app.services.errors import InvalidInputError


def _connection() -> models.ProviderConnection:
    return models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.TEI.value,
        label="TEI",
        config={"base_url": "http://tei.test:8080"},
    )


def test_descriptor_explains_one_model_per_connection() -> None:
    base_url = next(
        field for field in TEIAdapter.descriptor.config_fields if field.name == "base_url"
    )

    assert base_url.description == "Each TEI connection serves one model and task."


@pytest.mark.parametrize(
    ("model_type", "requested", "expected"),
    [
        ({"embedding": {"pooling": "mean"}}, ProviderKind.EMBEDDING, ProviderKind.EMBEDDING),
        ({"reranker": {"id2label": {"0": "not relevant"}}}, ProviderKind.RERANKING, ProviderKind.RERANKING),
    ],
)
def test_list_models_exposes_its_one_served_model_for_matching_task(
    monkeypatch: pytest.MonkeyPatch,
    model_type: dict[str, object],
    requested: ProviderKind,
    expected: ProviderKind,
) -> None:
    adapter = TEIAdapter(_connection())
    info = TEIInfo(
        model_id="BAAI/example",
        model_type=model_type,
        max_input_length=512,
    )
    monkeypatch.setattr(adapter, "_info", lambda _force_refresh=False: info)

    catalog = adapter.list_models(requested)

    assert len(catalog.models) == 1
    model = catalog.models[0]
    assert model.id == "BAAI/example"
    assert model.max_input_tokens == 512
    assert model.input_modalities == ["text"]
    assert model.output_modalities == (
        ["embedding"] if expected is ProviderKind.EMBEDDING else ["rerank"]
    )


def test_list_models_rejects_a_task_that_does_not_match_the_served_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = TEIAdapter(_connection())
    monkeypatch.setattr(
        adapter,
        "_info",
        lambda _force_refresh=False: TEIInfo(
            model_id="BAAI/bge-reranker-base",
            model_type={"reranker": {"id2label": {"0": "not relevant"}}},
            max_input_length=512,
        ),
    )

    with pytest.raises(InvalidInputError, match="does not serve embedding"):
        adapter.list_models(ProviderKind.EMBEDDING)


def test_list_models_rejects_a_non_reranking_classifier_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = TEIAdapter(_connection())
    monkeypatch.setattr(
        adapter,
        "_info",
        lambda _force_refresh=False: TEIInfo(
            model_id="acme/sentiment",
            model_type={"classifier": {"id2label": {"0": "negative", "1": "positive"}}},
            max_input_length=512,
        ),
    )

    with pytest.raises(InvalidInputError, match="unsupported model_type"):
        adapter.list_models(ProviderKind.RERANKING)
