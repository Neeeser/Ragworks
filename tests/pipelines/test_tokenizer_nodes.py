from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.chunking import TokenChunkerNode
from app.pipelines.nodes.tokenizers import HuggingFaceTokenizerConfig
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.ports import NodePort
from app.pipelines.registry import build_default_registry
from app.pipelines.validation import PipelineValidator
from app.schemas.pipelines import NodePortRead
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider


def _context(tmp_path: Path) -> PipelineRunContext:
    user = models.User(email="tokenizer@test.local", hashed_password="hashed")
    collection = models.Collection(
        id=uuid4(),
        user_id=user.id,
        name="Tokenizer collection",
        description="",
        extra_metadata={},
    )
    return PipelineRunContext(
        session=Session(),
        user=user,
        collection=collection,
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(),
        storage=FileStorage(base_path=tmp_path),
        settings=get_settings(),
    )


def test_tokenizer_spec_is_frozen_and_huggingface_requires_a_model_id() -> None:
    spec = TokenizerSpec(kind="wordpiece")

    with pytest.raises(ValidationError):
        spec.kind = "whitespace"
    with pytest.raises(ValidationError, match="model id"):
        TokenizerSpec(kind="huggingface")


def test_registry_exposes_four_tokenizer_resource_nodes() -> None:
    registry = build_default_registry()
    specs = {spec.type: spec for spec in registry.specs()}

    assert {
        "tokenizer.wordpiece",
        "tokenizer.cl100k",
        "tokenizer.whitespace",
        "tokenizer.huggingface",
    } <= specs.keys()
    for node_type in (
        "tokenizer.wordpiece",
        "tokenizer.cl100k",
        "tokenizer.whitespace",
        "tokenizer.huggingface",
    ):
        assert specs[node_type].input_ports == []
        assert [(port.key, port.data_type) for port in specs[node_type].output_ports] == [
            ("tokenizer", "tokenizer")
        ]


def test_node_port_wire_schema_preserves_non_variadic_metadata() -> None:
    port = NodePortRead.model_validate(
        NodePort(
            key="tokenizer",
            label="Tokenizer",
            data_type="tokenizer",
            required=False,
            accepts_many=False,
        ),
        from_attributes=True,
    )

    assert port.model_dump() == {
        "key": "tokenizer",
        "label": "Tokenizer",
        "data_type": "tokenizer",
        "required": False,
        "accepts_many": False,
    }


def test_all_chunkers_have_one_optional_non_variadic_tokenizer_port() -> None:
    registry = build_default_registry()

    for node_type in (
        "chunker.collection",
        "chunker.token",
        "chunker.sentence",
        "chunker.paragraph",
        "chunker.semantic",
    ):
        spec = registry.get_spec(node_type)
        assert spec is not None
        tokenizer_port = next(port for port in spec.input_ports if port.key == "tokenizer")
        assert tokenizer_port.required is False
        assert tokenizer_port.accepts_many is False


def test_static_tokenizer_node_emits_its_spec(tmp_path: Path) -> None:
    registry = build_default_registry()
    node = registry.create(
        PipelineNodeDefinition(
            id="tokenizer",
            type="tokenizer.cl100k",
            name="cl100k tokenizer",
        )
    )

    outputs = node.run({}, _context(tmp_path))

    assert outputs == {"tokenizer": TokenizerSpec(kind="cl100k")}


def test_huggingface_tokenizer_node_checks_cache_and_emits_model_id(
    tmp_path: Path,
    monkeypatch,
) -> None:
    checked: list[str] = []
    monkeypatch.setattr(
        "app.services.huggingface_tokenizers.HuggingFaceTokenizerService.ensure_available",
        lambda _service, _user, model_id: checked.append(model_id),
    )
    node = build_default_registry().create(
        PipelineNodeDefinition(
            id="tokenizer",
            type="tokenizer.huggingface",
            name="HuggingFace tokenizer",
            config={"hf_model_id": "owner/model"},
        )
    )

    outputs = node.run({}, _context(tmp_path))
    summary = node.summarize_io({}, outputs)

    assert checked == ["owner/model"]
    assert outputs == {
        "tokenizer": TokenizerSpec(kind="huggingface", hf_model_id="owner/model")
    }
    assert summary.outputs[0].value == {
        "kind": "huggingface",
        "hf_model_id": "owner/model",
    }


def test_huggingface_tokenizer_config_rejects_unsafe_model_ids() -> None:
    with pytest.raises(ValidationError):
        HuggingFaceTokenizerConfig(hf_model_id="../../etc/passwd")


def test_huggingface_tokenizer_requires_a_model_id_before_save() -> None:
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="tokenizer",
                type="tokenizer.huggingface",
                name="HuggingFace tokenizer",
            )
        ]
    )

    result = PipelineValidator(build_default_registry()).validate(definition)

    assert result.valid is False
    assert result.issues[0].field == "hf_model_id"


def test_huggingface_tokenizer_reports_an_unsafe_model_id_as_a_field_issue() -> None:
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="tokenizer",
                type="tokenizer.huggingface",
                name="HuggingFace tokenizer",
                config={"hf_model_id": "../../unsafe"},
            )
        ]
    )

    result = PipelineValidator(build_default_registry()).validate(definition)

    assert result.valid is False
    assert result.issues[0].field == "hf_model_id"


def test_huggingface_tokenizer_with_a_model_id_has_no_node_issue() -> None:
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="tokenizer",
                type="tokenizer.huggingface",
                name="HuggingFace tokenizer",
                config={"hf_model_id": "owner/model"},
            )
        ]
    )

    result = PipelineValidator(build_default_registry()).validate(definition)

    assert result.valid is True


def test_chunker_defaults_to_wordpiece_when_tokenizer_port_is_empty(monkeypatch) -> None:
    captured: list[TokenizerSpec] = []

    class _Counter:
        def count(self, text: str) -> int:
            return len(text.split())

        def split(self, text: str, max_tokens: int, overlap: int = 0) -> list[str]:
            return [text]

    def _build(spec: TokenizerSpec, _storage_path: Path):
        captured.append(spec)
        return _Counter()

    monkeypatch.setattr("app.pipelines.nodes.chunking.build_token_counter", _build)

    assert TokenChunkerNode.resolve_tokenizer({}) == TokenizerSpec(kind="wordpiece")
    assert captured == []
