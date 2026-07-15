from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.chunking import ChunkerConfig, FixedChunkerConfig, TokenChunkerNode
from app.pipelines.payloads import ParsedDocumentPayload, TokenizerSpec
from app.retrieval.models import Document, DocumentMetadata
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


def test_chunker_config_defaults_to_wordpiece() -> None:
    config = FixedChunkerConfig()
    configurable = ChunkerConfig(tokenizer="cl100k")

    assert config.tokenizer == "wordpiece"
    assert config.hf_model_id is None
    assert configurable.tokenizer == "cl100k"


def test_huggingface_chunker_config_requires_valid_model_id() -> None:
    with pytest.raises(ValidationError, match="model id"):
        FixedChunkerConfig(tokenizer="huggingface")
    with pytest.raises(ValidationError, match="model id"):
        FixedChunkerConfig(tokenizer="huggingface", hf_model_id="../../unsafe")

    config = FixedChunkerConfig(tokenizer="huggingface", hf_model_id="owner/model")

    assert config.hf_model_id == "owner/model"


@pytest.mark.parametrize("tokenizer", ["wordpiece", "cl100k", "whitespace"])
def test_non_huggingface_chunker_config_rejects_model_id(tokenizer: str) -> None:
    with pytest.raises(ValidationError, match="Only a HuggingFace tokenizer"):
        FixedChunkerConfig(tokenizer=tokenizer, hf_model_id="owner/model")


def test_chunker_run_builds_counter_from_its_config(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolved: list[TokenizerSpec] = []

    class Counter:
        def count(self, text: str) -> int:
            return len(text.split())

        def split(self, text: str, max_tokens: int, overlap: int = 0) -> list[str]:
            return [text]

    def resolve(spec: TokenizerSpec, _storage_path: Path) -> Counter:
        resolved.append(spec)
        return Counter()

    monkeypatch.setattr("app.pipelines.nodes.chunking.build_token_counter", resolve)
    node = TokenChunkerNode(
        FixedChunkerConfig(
            chunk_size=512,
            chunk_overlap=0,
            tokenizer="huggingface",
            hf_model_id="owner/model",
        )
    )
    document = Document(
        document_id="doc-1",
        text="configured tokenizer",
        metadata=DocumentMetadata(),
    )

    result = node.run(
        {"document": ParsedDocumentPayload(document=document).model_dump()},
        _context(tmp_path),
    )

    assert resolved == [TokenizerSpec(kind="huggingface", hf_model_id="owner/model")]
    assert result["chunks"].tokenizer == resolved[0]
