from __future__ import annotations

from copy import deepcopy

from sqlmodel import Session

from app.db import models
from app.services.tokenizer_migration import (
    migrate_tokenizer_definition,
    migrate_tokenizer_nodes,
)


def _definition() -> dict[str, object]:
    return {
        "nodes": [
            {"id": "tokenizer", "type": "tokenizer.cl100k", "config": {}},
            {"id": "chunk-a", "type": "chunker.token", "config": {"chunk_size": 256}},
            {"id": "chunk-b", "type": "chunker.sentence", "config": {}},
            {"id": "parser", "type": "parser.document", "config": {}},
        ],
        "edges": [
            {
                "id": "tokenizer-a",
                "source": "tokenizer",
                "target": "chunk-a",
                "source_port": "tokenizer",
                "target_port": "tokenizer",
            },
            {
                "id": "tokenizer-b",
                "source": "tokenizer",
                "target": "chunk-b",
                "source_port": "tokenizer",
                "target_port": "tokenizer",
            },
            {
                "id": "parser-a",
                "source": "parser",
                "target": "chunk-a",
                "source_port": "document",
                "target_port": "document",
            },
        ],
        "viewport": {"x": 1},
    }


def test_migration_folds_tokenizer_into_each_connected_chunker_and_removes_layout() -> None:
    migrated = migrate_tokenizer_definition(_definition())

    nodes = {node["id"]: node for node in migrated["nodes"]}
    assert "tokenizer" not in nodes
    assert nodes["chunk-a"]["config"] == {"chunk_size": 256, "tokenizer": "cl100k"}
    assert nodes["chunk-b"]["config"] == {"tokenizer": "cl100k"}
    assert [edge["id"] for edge in migrated["edges"]] == ["parser-a"]
    assert migrated["viewport"] == {"x": 1}


def test_migration_carries_huggingface_model_id() -> None:
    definition = _definition()
    definition["nodes"][0]["type"] = "tokenizer.huggingface"
    definition["nodes"][0]["config"] = {"hf_model_id": "owner/model"}

    migrated = migrate_tokenizer_definition(definition)

    chunk = next(node for node in migrated["nodes"] if node["id"] == "chunk-a")
    assert chunk["config"]["tokenizer"] == "huggingface"
    assert chunk["config"]["hf_model_id"] == "owner/model"


def test_migration_deletes_unconnected_tokenizer_and_preserves_tokenizerless_definition() -> None:
    unconnected = _definition()
    unconnected["edges"] = [unconnected["edges"][2]]
    tokenizerless = {
        "nodes": [unconnected["nodes"][1]],
        "edges": [],
        "viewport": {},
    }
    original = deepcopy(tokenizerless)

    migrated_unconnected = migrate_tokenizer_definition(unconnected)
    migrated_tokenizerless = migrate_tokenizer_definition(tokenizerless)

    assert all(not node["type"].startswith("tokenizer.") for node in migrated_unconnected["nodes"])
    assert migrated_tokenizerless == original


def test_migration_is_idempotent() -> None:
    once = migrate_tokenizer_definition(_definition())

    assert migrate_tokenizer_definition(once) == once


def test_startup_migration_rewrites_every_stored_version(session: Session) -> None:
    user = models.User(email="tokenizer-migration@example.com", hashed_password="hashed")
    session.add(user)
    session.commit()
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Tokenizer migration",
        kind=models.PipelineKind.INGESTION,
        current_version=2,
    )
    session.add(pipeline)
    session.commit()
    versions = [
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition=_definition(),
        ),
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=2,
            definition={"nodes": [], "edges": [], "viewport": {}},
        ),
    ]
    session.add_all(versions)
    session.commit()

    migrate_tokenizer_nodes(session)
    migrate_tokenizer_nodes(session)

    with Session(session.get_bind()) as fresh:
        migrated = fresh.get(models.PipelineVersion, versions[0].id)
        untouched = fresh.get(models.PipelineVersion, versions[1].id)
        assert migrated is not None
        assert untouched is not None
        assert all(
            not node["type"].startswith("tokenizer.")
            for node in migrated.definition["nodes"]
        )
        assert untouched.definition == {"nodes": [], "edges": [], "viewport": {}}
