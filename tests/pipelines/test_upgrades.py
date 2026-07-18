"""Stored-definition upgrades: legacy nodes and the variables v1 -> v2 migration."""

from __future__ import annotations

import logging

import pytest
from sqlmodel import Session

from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.upgrades import migrate_variables_definition, upgrade_definition
from app.pipelines.validation import PipelineValidationResult
from app.pipelines.variables import VariableSource
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


def test_upgrade_definition_bypasses_legacy_reranker_and_keeps_result_limit() -> None:
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="retriever", type="retriever.vector", name="Retriever"),
            PipelineNodeDefinition(
                id="reranker",
                type="reranker.cross_encoder",
                name="Cross-Encoder Reranker",
                config={"enabled": True, "model_name": "legacy-model"},
            ),
            PipelineNodeDefinition(
                id="limit",
                type="limit.results",
                name="Result Limit",
                config={"max_results": 7},
            ),
            PipelineNodeDefinition(id="out", type="retrieval.output", name="Output"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="retriever-reranker",
                source="retriever",
                target="reranker",
                source_port="results",
                target_port="results",
            ),
            PipelineEdgeDefinition(
                id="reranker-limit",
                source="reranker",
                target="limit",
                source_port="results",
                target_port="results",
            ),
            PipelineEdgeDefinition(
                id="limit-output",
                source="limit",
                target="out",
                source_port="results",
                target_port="results",
            ),
        ],
    )

    upgraded = upgrade_definition(definition)

    assert upgraded is not None
    assert "reranker" not in upgraded.node_map()
    assert upgraded.node_map()["limit"] == definition.node_map()["limit"]
    assert upgraded.node_map()["limit"].config == {"max_results": 7}
    assert any(
        edge.source == "retriever"
        and edge.target == "limit"
        and edge.source_port == "results"
        and edge.target_port == "results"
        for edge in upgraded.edges
    )
    assert upgraded.node_map()["retriever"].config.get("top_k") is None


def test_upgrade_definition_splices_reranker_fan_in_out_with_stable_unique_ids() -> None:
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source-a", type="retriever.vector", name="Source A"),
            PipelineNodeDefinition(id="source-b", type="retriever.bm25", name="Source B"),
            PipelineNodeDefinition(
                id="reranker", type="reranker.cross_encoder", name="Legacy Reranker"
            ),
            PipelineNodeDefinition(id="target-a", type="limit.results", name="Limit"),
            PipelineNodeDefinition(id="target-b", type="retrieval.output", name="Output"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="in-a",
                source="source-a",
                target="reranker",
                source_port="results-a",
                target_port="input-a",
            ),
            PipelineEdgeDefinition(
                id="in-b",
                source="source-b",
                target="reranker",
                source_port="results-b",
                target_port="input-b",
            ),
            PipelineEdgeDefinition(
                id="out-a",
                source="reranker",
                target="target-a",
                source_port="output-a",
                target_port="results-a",
            ),
            PipelineEdgeDefinition(
                id="out-b",
                source="reranker",
                target="target-b",
                source_port="output-b",
                target_port="results-b",
            ),
            PipelineEdgeDefinition(
                id="edge-source-a-target-a",
                source="source-a",
                target="target-a",
                source_port="existing",
                target_port="existing",
            ),
        ],
    )

    first = upgrade_definition(definition)
    second = upgrade_definition(definition)

    assert first is not None
    assert second is not None
    assert first.edges == second.edges
    assert len({edge.id for edge in first.edges}) == len(first.edges)
    spliced = [
        edge
        for edge in first.edges
        if edge.source_port in {"results-a", "results-b"}
        and edge.target_port in {"results-a", "results-b"}
    ]
    assert {
        (edge.source, edge.target, edge.source_port, edge.target_port)
        for edge in spliced
    } == {
        (source, target, source_port, target_port)
        for source, source_port in (("source-a", "results-a"), ("source-b", "results-b"))
        for target, target_port in (("target-a", "results-a"), ("target-b", "results-b"))
    }


def test_upgrade_definition_returns_none_when_already_current() -> None:
    definition = _legacy_retrieval_definition()
    first = upgrade_definition(definition)
    assert first is not None

    assert upgrade_definition(first) is None


def test_upgrade_definition_renames_result_limit_in_place_and_preserves_edges() -> None:
    definition = PipelineDefinition.model_validate(
        {
            "schema_version": 2,
            "variables": [
                {
                    "name": "top_k",
                    "type": "integer",
                    "source": "input",
                    "value": 5,
                }
            ],
            "nodes": [
                {
                    "id": "in",
                    "type": "retrieval.input",
                    "name": "Input",
                    "config": {"arguments": ["top_k"]},
                },
                {
                    "id": "fusion",
                    "type": "fusion.rrf",
                    "name": "Fusion",
                    "config": {"k": 60},
                },
                {
                    "id": "limit",
                    "type": "limit.top_n",
                    "name": "Top-N",
                    "config": {"top_n": {"$expr": "top_k"}},
                },
                {
                    "id": "out",
                    "type": "retrieval.output",
                    "name": "Output",
                    "config": {},
                },
            ],
            "edges": [
                {
                    "id": "fusion-limit",
                    "source": "fusion",
                    "target": "limit",
                    "source_port": "results",
                    "target_port": "results",
                },
                {
                    "id": "limit-out",
                    "source": "limit",
                    "target": "out",
                    "source_port": "results",
                    "target_port": "results",
                },
            ],
        }
    )

    upgraded = upgrade_definition(definition)

    assert upgraded is not None
    limit = upgraded.node_map()["limit"]
    assert limit.type == "limit.results"
    assert limit.name == "Result Limit"
    assert limit.config == {"max_results": {"$expr": "result_limit"}}
    assert upgraded.node_map()["in"].config["arguments"] == ["result_limit"]
    assert [variable.name for variable in upgraded.variables] == ["result_limit"]
    assert upgraded.edges == definition.edges
    assert upgrade_definition(upgraded) is None


def test_upgrade_definition_preserves_custom_result_limit_name() -> None:
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="limit",
                type="limit.top_n",
                name="Keep the best chunks",
                config={"top_n": 7},
            )
        ]
    )

    upgraded = upgrade_definition(definition)

    assert upgraded is not None
    assert upgraded.nodes[0].name == "Keep the best chunks"


def _v1_raw_definition(*, fusion_top_k: object | None = None) -> dict[str, object]:
    """A raw stored definition exactly as the pre-variables release wrote it.

    No `variables` list and no `schema_version` key — argument objects live on
    the input node's config and fusion truncated (config `top_k`, else the
    run's requested top_k).
    """
    fusion_config: dict[str, object] = {"k": 60}
    if fusion_top_k is not None:
        fusion_config["top_k"] = fusion_top_k
    return {
        "nodes": [
            {
                "id": "in",
                "type": "retrieval.input",
                "name": "Input",
                "config": {
                    "arguments": [
                        {
                            "name": "top_k",
                            "type": "integer",
                            "description": "How many chunks to retrieve.",
                            "default": 5,
                            "minimum": 1,
                            "maximum": 10,
                            "expose_to_llm": True,
                        }
                    ]
                },
            },
            {
                "id": "sem",
                "type": "retriever.vector",
                "name": "Semantic",
                "config": {"backend": "pgvector", "index_name": "docs"},
            },
            {"id": "fuse", "type": "fusion.rrf", "name": "Fusion", "config": fusion_config},
            {"id": "out", "type": "retrieval.output", "name": "Output", "config": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "in",
                "target": "sem",
                "source_port": "request",
                "target_port": "request",
            },
            {
                "id": "e2",
                "source": "sem",
                "target": "fuse",
                "source_port": "results",
                "target_port": "results",
            },
            {
                "id": "e3",
                "source": "fuse",
                "target": "out",
                "source_port": "results",
                "target_port": "results",
            },
        ],
        "viewport": {},
    }


class TestMigrateVariablesDefinition:
    """The v1 -> v2 rewrite: arguments become input variables, fusion gets a cut."""

    def test_argument_objects_become_input_variables(self) -> None:
        definition = PipelineDefinition.model_validate(_v1_raw_definition())

        migrated = migrate_variables_definition(definition)

        input_node = migrated.node_map()["in"]
        assert input_node.config["arguments"] == ["result_limit"]
        variable = next(v for v in migrated.variables if v.name == "result_limit")
        assert variable.source is VariableSource.INPUT
        assert variable.value == 5
        assert variable.minimum == 1
        assert variable.maximum == 10
        assert variable.expose_to_llm is True

    def test_partially_migrated_string_arguments_use_the_new_name(self) -> None:
        raw = _v1_raw_definition()
        nodes = raw["nodes"]
        assert isinstance(nodes, list)
        nodes[0]["config"]["arguments"] = ["top_k"]
        raw["variables"] = [
            {
                "name": "top_k",
                "type": "integer",
                "source": "input",
                "value": 5,
            }
        ]

        migrated = migrate_variables_definition(PipelineDefinition.model_validate(raw))

        assert migrated.node_map()["in"].config["arguments"] == ["result_limit"]
        assert [variable.name for variable in migrated.variables] == ["result_limit"]

    def test_required_argument_migrates_to_no_default(self) -> None:
        raw = _v1_raw_definition()
        nodes = raw["nodes"]
        assert isinstance(nodes, list)
        nodes[0]["config"]["arguments"] = [
            {"name": "mode", "type": "string", "required": True, "default": "x"}
        ]
        migrated = migrate_variables_definition(PipelineDefinition.model_validate(raw))
        variable = next(v for v in migrated.variables if v.name == "mode")
        assert variable.value is None  # required stays required

    def test_fusion_gets_topn_inserted_preserving_the_cut(self) -> None:
        definition = PipelineDefinition.model_validate(
            _v1_raw_definition(fusion_top_k={"$expr": "top_k * 2"})
        )

        migrated = migrate_variables_definition(definition)

        fusion = migrated.node_map()["fuse"]
        assert "top_k" not in fusion.config
        limit = next(node for node in migrated.nodes if node.type == "limit.results")
        assert limit.name == "Result Limit"
        assert limit.config == {"max_results": {"$expr": "result_limit * 2"}}
        # Fusion's old outgoing edge now leaves the Top-N node.
        assert any(edge.source == limit.id and edge.target == "out" for edge in migrated.edges)
        assert any(edge.source == "fuse" and edge.target == limit.id for edge in migrated.edges)

    def test_fusion_without_explicit_top_k_gets_unset_topn(self) -> None:
        """v1 fusion fell back to the requested top_k; the unset Top-N keeps that."""
        migrated = migrate_variables_definition(
            PipelineDefinition.model_validate(_v1_raw_definition())
        )
        limit = next(node for node in migrated.nodes if node.type == "limit.results")
        assert limit.config == {}

    def test_pre_variables_definition_gains_the_default_result_limit(self) -> None:
        """A pre-branch retrieval definition (no declarations at all) is rewritten
        to the new-default shape: the implicit hardcoded tool contract becomes the
        scaffold's explicit top_k input variable, accepted by the input node, with
        the inserted Top-N pointed at it."""
        raw = _v1_raw_definition()
        nodes = raw["nodes"]
        assert isinstance(nodes, list)
        nodes[0]["config"] = {}  # pre-variables: no arguments key at all

        migrated = migrate_variables_definition(PipelineDefinition.model_validate(raw))

        variable = next(v for v in migrated.variables if v.name == "result_limit")
        assert variable.source is VariableSource.INPUT
        assert variable.value == 5
        assert (variable.minimum, variable.maximum) == (1, 10)
        assert variable.expose_to_llm is True
        assert migrated.node_map()["in"].config["arguments"] == ["result_limit"]
        limit = next(node for node in migrated.nodes if node.type == "limit.results")
        assert limit.config == {"max_results": {"$expr": "result_limit"}}
        # Retrievers lose the invisible request-depth fallback: the migration
        # pins their fetch depth to the declared top_k variable.
        assert migrated.node_map()["sem"].config["top_k"] == {"$expr": "result_limit"}

    def test_retrievers_gain_the_top_k_expression(self) -> None:
        """Every retriever with no configured depth gets `top_k` pinned to the
        declared variable — the v1 request-depth fallback made explicit."""
        migrated = migrate_variables_definition(
            PipelineDefinition.model_validate(_v1_raw_definition())
        )
        assert migrated.node_map()["sem"].config["top_k"] == {"$expr": "result_limit"}

    def test_explicit_top_k_expression_tracks_the_renamed_argument(self) -> None:
        """Config expressions migrate with the caller-facing variable name."""
        raw = _v1_raw_definition()
        nodes = raw["nodes"]
        assert isinstance(nodes, list)
        nodes[1]["config"]["top_k"] = {"$expr": "top_k * 2"}
        migrated = migrate_variables_definition(PipelineDefinition.model_validate(raw))
        assert migrated.node_map()["sem"].config["top_k"] == {"$expr": "result_limit * 2"}

    def test_derived_and_output_expressions_track_the_renamed_argument(self) -> None:
        raw = _v1_raw_definition()
        raw["variables"] = [
            {
                "name": "candidate_pool",
                "type": "integer",
                "expression": "top_k * 2",
            }
        ]
        nodes = raw["nodes"]
        assert isinstance(nodes, list)
        nodes[-1]["config"] = {"outputs": [{"name": "requested", "expression": "top_k + 1"}]}

        migrated = migrate_variables_definition(PipelineDefinition.model_validate(raw))

        candidate_pool = next(v for v in migrated.variables if v.name == "candidate_pool")
        assert candidate_pool.expression == "result_limit * 2"
        assert migrated.node_map()["out"].config["outputs"] == [
            {"name": "requested", "expression": "result_limit + 1"}
        ]

    def test_retrievers_get_literal_depth_when_no_top_k_variable(self) -> None:
        """A definition whose declared inputs never included a depth gets the
        literal historical default — there is no variable to reference."""
        raw = _v1_raw_definition()
        nodes = raw["nodes"]
        assert isinstance(nodes, list)
        nodes[0]["config"]["arguments"] = [{"name": "mode", "type": "string", "default": "fast"}]
        migrated = migrate_variables_definition(PipelineDefinition.model_validate(raw))
        assert migrated.node_map()["sem"].config["top_k"] == 5

    def test_declared_pipelines_rename_top_k_without_adding_a_duplicate(self) -> None:
        """A definition that already declares inputs keeps exactly its own."""
        migrated = migrate_variables_definition(
            PipelineDefinition.model_validate(_v1_raw_definition())
        )
        assert [v.name for v in migrated.variables] == ["result_limit"]
        assert migrated.variables[0].value == 5  # the declared one, not a duplicate


def test_stored_v1_definition_is_migrated_once(session: Session) -> None:
    """A raw v1 row is rewritten and stamped; a later boot never touches it again."""
    user = models.User(email="v1@example.com", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    pipeline = models.Pipeline(user_id=user.id, name="V1", kind=models.PipelineKind.RETRIEVAL)
    session.add(pipeline)
    session.flush()
    version = models.PipelineVersion(
        pipeline_id=pipeline.id,
        version=1,
        definition=_v1_raw_definition(),
        created_by=user.id,
    )
    session.add(version)
    session.commit()

    assert upgrade_stored_pipeline_definitions(session) == 1
    session.commit()

    stored = PipelineService(session).get_definition(pipeline)
    assert any(node.type == "limit.results" for node in stored.nodes)
    assert any(variable.source is VariableSource.INPUT for variable in stored.variables)
    assert version.definition.get("schema_version") == 2

    # The user deletes the migrated Top-N node — the next boot must not reinsert it.
    trimmed = stored.model_copy(
        update={
            "nodes": [node for node in stored.nodes if node.type != "limit.results"],
            "edges": [
                edge
                for edge in stored.edges
                if all(
                    node.type != "limit.results"
                    for node in stored.nodes
                    if node.id in (edge.source, edge.target)
                )
            ],
        }
    )
    version.definition = trimmed.model_dump(mode="json")
    session.add(version)
    session.commit()

    assert upgrade_stored_pipeline_definitions(session) == 0
    session.commit()
    after = PipelineService(session).get_definition(pipeline)
    assert all(node.type != "limit.results" for node in after.nodes)


def test_upgrade_stored_pipeline_definitions_rewrites_versions_in_place(
    session: Session, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    user = models.User(email="upgrade@example.com", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    # Insert at the storage boundary: this fixture represents data persisted by
    # an older release, which the current service correctly refuses to create.
    pipeline = models.Pipeline(
        user_id=user.id,
        name="Legacy",
        kind=models.PipelineKind.RETRIEVAL,
    )
    session.add(pipeline)
    session.flush()
    session.add(
        models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition=_legacy_retrieval_definition().model_dump(mode="json"),
            created_by=user.id,
        )
    )
    session.commit()
    service = PipelineService(session)

    warning = "Embedding model has an advisory input-limit warning."
    monkeypatch.setattr(
        "app.services.pipeline_upgrades.validate_pipeline_definition",
        lambda *_args, **_kwargs: PipelineValidationResult(
            valid=True,
            warnings=[warning],
            issues=[PipelineValidationIssue(message=warning, severity="warning")],
        ),
    )

    with caplog.at_level(logging.WARNING, logger="app.services.pipeline_validation"):
        upgraded_count = upgrade_stored_pipeline_definitions(session)
    session.commit()

    assert upgraded_count == 1
    stored = service.get_definition(pipeline)
    assert all(node.type != "chat.settings" for node in stored.nodes)
    assert any(node.type == "retriever.vector" for node in stored.nodes)
    # Same version row, rewritten in place -- no new revision minted.
    assert pipeline.current_version == 1
    assert warning in caplog.text
    # Idempotent on the second run.
    assert upgrade_stored_pipeline_definitions(session) == 0
