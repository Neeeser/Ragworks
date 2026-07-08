"""Stored-definition upgrades: legacy backend-pinned nodes and chat.settings."""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.upgrades import upgrade_definition
from app.services.pipelines import PipelineService, upgrade_stored_pipeline_definitions


def _legacy_retrieval_definition() -> PipelineDefinition:
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="in", type="retrieval.input", name="Input"),
            PipelineNodeDefinition(
                id="retr",
                type="retriever.pinecone",
                name="Retriever",
                config={"namespace": "ns"},
            ),
            PipelineNodeDefinition(
                id="chat",
                type="chat.settings",
                name="Chat Settings",
                config={"chat_model": "old-model", "context_window": 4096},
            ),
            PipelineNodeDefinition(id="out", type="retrieval.output", name="Output"),
        ],
        edges=[
            PipelineEdgeDefinition(id="e1", source="in", target="retr"),
            PipelineEdgeDefinition(id="e2", source="retr", target="out"),
        ],
    )


def test_upgrade_definition_rewrites_legacy_nodes_and_drops_chat_settings() -> None:
    upgraded = upgrade_definition(_legacy_retrieval_definition())

    assert upgraded is not None
    types = [node.type for node in upgraded.nodes]
    assert "chat.settings" not in types
    retriever = next(node for node in upgraded.nodes if node.id == "retr")
    assert retriever.type == "retriever.vector"
    assert retriever.config["backend"] == "pinecone"
    # Legacy config omitted the index name (relied on the node type's
    # default); the upgrade pins it explicitly.
    assert retriever.config["index_name"]
    assert retriever.config["namespace"] == "ns"
    # Untouched edges survive; the ids stay stable.
    assert [edge.id for edge in upgraded.edges] == ["e1", "e2"]


def test_upgrade_definition_drops_edges_touching_removed_nodes() -> None:
    definition = _legacy_retrieval_definition()
    definition.edges.append(PipelineEdgeDefinition(id="e3", source="retr", target="chat"))

    upgraded = upgrade_definition(definition)

    assert upgraded is not None
    assert all(edge.target != "chat" for edge in upgraded.edges)


def test_upgrade_definition_returns_none_when_already_current() -> None:
    definition = _legacy_retrieval_definition()
    first = upgrade_definition(definition)
    assert first is not None

    assert upgrade_definition(first) is None


def test_upgrade_stored_pipeline_definitions_rewrites_versions_in_place(
    session: Session,
) -> None:
    user = models.User(email="upgrade@example.com", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    service = PipelineService(session)
    pipeline = service.create_pipeline(
        user=user,
        name="Legacy",
        kind=models.PipelineKind.RETRIEVAL,
        definition=_legacy_retrieval_definition(),
    )
    session.commit()

    upgraded_count = upgrade_stored_pipeline_definitions(session)
    session.commit()

    assert upgraded_count == 1
    stored = service.get_definition(pipeline)
    assert all(node.type != "chat.settings" for node in stored.nodes)
    assert any(node.type == "retriever.vector" for node in stored.nodes)
    # Same version row, rewritten in place -- no new revision minted.
    assert pipeline.current_version == 1
    # Idempotent on the second run.
    assert upgrade_stored_pipeline_definitions(session) == 0
