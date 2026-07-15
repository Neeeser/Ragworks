from __future__ import annotations

from uuid import uuid4

from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.payloads import TokenizerSpec
from app.pipelines.registry import default_registry
from app.pipelines.settings import resolve_ingestion_settings
from app.pipelines.template import resolve_collection_template


def _collection() -> models.Collection:
    return models.Collection(
        id=uuid4(),
        user_id=uuid4(),
        name="Test Collection",
        description="",
        extra_metadata={},
    )


def test_resolve_collection_template_accepts_none() -> None:
    collection = _collection()

    assert resolve_collection_template(None, collection) is None


def test_resolve_collection_template_replaces_placeholders() -> None:
    """Every placeholder resolve_collection_template documents gets substituted."""
    collection = _collection()

    rendered = resolve_collection_template(
        "col-{collection_id}-{collection_name}-{user_id}",
        collection,
    )

    assert rendered == f"col-{collection.id}-{collection.name}-{collection.user_id}"


def test_resolve_ingestion_settings_falls_back_to_configurable_chunker_when_no_fixed_node() -> None:
    """With no fixed-strategy chunker node present, `_resolve_chunker_config`
    falls through to the configurable `chunker.collection` node type -- an
    empty definition has none of those either, so this pins the literal
        built-in default (token/512/200) rather than re-deriving it from
    `ChunkerConfig()`, which would just prove the two reads of the same
    default agree with each other.
    """
    definition = PipelineDefinition(nodes=[], edges=[])
    collection = _collection()

    settings = resolve_ingestion_settings(definition, collection, default_registry())

    assert settings.chunk_strategy == models.ChunkStrategy.TOKEN
    assert settings.chunk_size == 512
    assert settings.chunk_overlap == 200
    assert settings.tokenizer == TokenizerSpec(kind="wordpiece")


def test_resolve_ingestion_settings_uses_fixed_strategy_chunker_config() -> None:
    """A fixed-strategy chunker node (e.g. `chunker.token`) drives the resolved
    chunk strategy/size/overlap from ITS OWN config -- not the node defaults.

    This is the case `_resolve_chunker_config` exists for: it walks the
    registry's fixed-strategy chunker classes (reading `type`/`strategy` off
    each class) rather than a hardcoded type-id-to-strategy table, so this
    test pins that the sentence-chunker's `type`/`strategy` class attributes
    are actually what gets picked up.
    """
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="chunker-1",
                type="chunker.sentence",
                name="Sentence Chunker",
                config={"chunk_size": 777, "chunk_overlap": 111},
            ),
        ],
        edges=[],
    )
    collection = _collection()

    settings = resolve_ingestion_settings(definition, collection, default_registry())

    assert settings.chunk_strategy == models.ChunkStrategy.SENTENCE
    assert settings.chunk_size == 777
    assert settings.chunk_overlap == 111


def test_resolve_ingestion_settings_follows_tokenizer_wired_to_chunker() -> None:
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="tokenizer-1",
                type="tokenizer.whitespace",
                name="Whitespace tokenizer",
            ),
            PipelineNodeDefinition(
                id="chunker-1",
                type="chunker.token",
                name="Token Chunker",
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-tokenizer-chunker",
                source="tokenizer-1",
                target="chunker-1",
                source_port="tokenizer",
                target_port="tokenizer",
            )
        ],
    )

    settings = resolve_ingestion_settings(definition, _collection(), default_registry())

    assert settings.tokenizer == TokenizerSpec(kind="whitespace")
