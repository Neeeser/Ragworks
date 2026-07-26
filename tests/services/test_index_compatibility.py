"""Capability checking for the backend a binding's index resolves to.

Because an index carries its backend, a graph that is valid as authored can be
invalid for one collection. These tests pin what the user is told: the
offending nodes by name, not a bare "incompatible backend" that leaves them
guessing which of a dozen nodes to change.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.counting import Bm25CountNode, Bm25FacetNode
from app.pipelines.nodes.retrieval import VectorRetrieverNode
from app.pipelines.registry import default_registry
from app.pipelines.resolution import resolve_static_definition
from app.pipelines.variables import (
    BindingContext,
    CollectionScope,
    PipelineVariable,
    VariableSource,
    VariableType,
)
from app.schemas.enums import IndexBackend
from app.services.binding_variables import resolve_binding_values
from app.services.errors import InvalidInputError
from app.services.index_compatibility import (
    incompatible_nodes,
    index_variable_vector_types,
)

REGISTRY = default_registry()


def _index_variable(name: str, backend: str, index_name: str) -> PipelineVariable:
    return PipelineVariable(
        name=name,
        type=VariableType.INDEX,
        source=VariableSource.BINDING,
        value={"index_id": str(uuid4()), "backend": backend, "name": index_name},
    )


def _facet_definition(backend: str = "pgvector") -> PipelineDefinition:
    """A graph containing a ParadeDB-only facet node, fed by an index variable."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="facet",
                type=Bm25FacetNode.type,
                name="Facet",
                config={
                    "backend": {"$expr": "bm25_index.backend"},
                    "index_name": {"$expr": "bm25_index.name"},
                    "field": "document_id",
                },
            )
        ],
        variables=[_index_variable("bm25_index", backend, "docs-bm25")],
    )


class TestIncompatibleNodes:
    """Which nodes cannot run against the backend they resolved to."""

    def test_facet_on_pgvector_is_fine(self) -> None:
        resolved = resolve_static_definition(_facet_definition("pgvector"))

        assert incompatible_nodes(resolved, REGISTRY) == []

    def test_facet_on_pinecone_is_reported_by_node(self) -> None:
        """Pinecone has no query-conditioned aggregation, so facet cannot run."""
        resolved = resolve_static_definition(_facet_definition("pinecone"))

        findings = incompatible_nodes(resolved, REGISTRY)

        assert [finding.node_id for finding in findings] == ["facet"]
        assert findings[0].backend is IndexBackend.PINECONE
        assert IndexBackend.PGVECTOR in findings[0].supported

    def test_the_message_names_the_node_and_what_would_work(self) -> None:
        resolved = resolve_static_definition(_facet_definition("pinecone"))

        message = incompatible_nodes(resolved, REGISTRY)[0].message

        assert "facet" in message
        assert "pinecone" in message
        assert "pgvector" in message

    def test_a_store_agnostic_node_is_never_flagged(self) -> None:
        definition = PipelineDefinition(
            nodes=[PipelineNodeDefinition(id="in", type="retrieval.input", name="In")]
        )

        assert incompatible_nodes(definition, REGISTRY) == []

    def test_a_plain_retriever_runs_on_either_backend(self) -> None:
        """Only capability-gated nodes restrict the backend."""
        for backend in ("pgvector", "pinecone"):
            definition = PipelineDefinition(
                nodes=[
                    PipelineNodeDefinition(
                        id="retriever",
                        type=VectorRetrieverNode.type,
                        name="Retriever",
                        config={
                            "backend": {"$expr": "primary_index.backend"},
                            "index_name": {"$expr": "primary_index.name"},
                        },
                    )
                ],
                variables=[_index_variable("primary_index", backend, "docs")],
            )

            resolved = resolve_static_definition(definition)

            assert incompatible_nodes(resolved, REGISTRY) == []


class TestVectorTypeDerivation:
    """Which plane a variable feeds, read from its consumers not its name."""

    def test_a_lexical_node_makes_its_variable_sparse(self) -> None:
        wanted = index_variable_vector_types(_facet_definition())

        assert wanted["bm25_index"] == "sparse"

    def test_a_dense_retriever_makes_its_variable_dense(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="retriever",
                    type=VectorRetrieverNode.type,
                    name="Retriever",
                    config={"index_name": {"$expr": "anything.name"}},
                )
            ]
        )

        assert index_variable_vector_types(definition)["anything"] == "dense"

    def test_a_variable_feeding_both_planes_resolves_sparse(self) -> None:
        """Sparse wins: a lexical node cannot read a dense index at all."""
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="retriever",
                    type=VectorRetrieverNode.type,
                    name="Retriever",
                    config={"index_name": {"$expr": "shared.name"}},
                ),
                PipelineNodeDefinition(
                    id="count",
                    type=Bm25CountNode.type,
                    name="Count",
                    config={"index_name": {"$expr": "shared.name"}},
                ),
            ]
        )

        assert index_variable_vector_types(definition)["shared"] == "sparse"

    def test_a_misleadingly_named_variable_follows_its_consumer(self) -> None:
        """Naming is not the signal — the node that reads it is."""
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="count",
                    type=Bm25CountNode.type,
                    name="Count",
                    config={"index_name": {"$expr": "dense_sounding_name.name"}},
                )
            ]
        )

        assert index_variable_vector_types(definition)["dense_sounding_name"] == "sparse"


class TestBindingRejection:
    """The API refuses a selection the graph cannot run, naming the nodes."""

    def _collection(self, session: Session) -> tuple[models.User, models.Collection]:
        user = models.User(email="compat@example.com", full_name="C", hashed_password="x")
        session.add(user)
        session.commit()
        session.refresh(user)
        collection = models.Collection(
            user_id=user.id, name="Docs", description="", extra_metadata={}
        )
        session.add(collection)
        session.commit()
        session.refresh(collection)
        return user, collection

    def test_pointing_a_facet_graph_at_pinecone_is_rejected(self, session: Session) -> None:
        user, collection = self._collection(session)
        index = models.RegisteredIndex(
            user_id=user.id,
            backend=IndexBackend.PINECONE,
            name="remote-sparse",
            vector_type="sparse",
        )
        session.add(index)
        session.commit()
        session.refresh(index)

        with pytest.raises(InvalidInputError) as error:
            resolve_binding_values(
                session,
                user,
                collection,
                _facet_definition(),
                {
                    "bm25_index": {
                        "index_id": str(index.id),
                        "backend": "pinecone",
                        "name": "remote-sparse",
                    }
                },
            )

        assert "facet" in str(error.value)
        assert "pgvector" in str(error.value)

    def test_an_index_the_user_does_not_own_is_rejected(self, session: Session) -> None:
        """Ownership is checked before compatibility — a 400, never a leak."""
        user, collection = self._collection(session)

        with pytest.raises(InvalidInputError, match="index not found"):
            resolve_binding_values(
                session,
                user,
                collection,
                _facet_definition(),
                {
                    "bm25_index": {
                        "index_id": str(uuid4()),
                        "backend": "pgvector",
                        "name": "someone-elses",
                    }
                },
            )

    def test_a_dense_index_in_a_lexical_slot_is_rejected(self, session: Session) -> None:
        """A BM25 node reading a dense index returns nothing rather than failing."""
        user, collection = self._collection(session)
        index = models.RegisteredIndex(
            user_id=user.id,
            backend=IndexBackend.PGVECTOR,
            name="dense-one",
            vector_type="dense",
        )
        session.add(index)
        session.commit()
        session.refresh(index)

        with pytest.raises(InvalidInputError, match="needs a sparse index"):
            resolve_binding_values(
                session,
                user,
                collection,
                _facet_definition(),
                {
                    "bm25_index": {
                        "index_id": str(index.id),
                        "backend": "pgvector",
                        "name": "dense-one",
                    }
                },
            )

    def test_a_value_for_an_undeclared_variable_is_rejected(self, session: Session) -> None:
        user, collection = self._collection(session)

        with pytest.raises(InvalidInputError, match="no binding variable named"):
            resolve_binding_values(
                session, user, collection, _facet_definition(), {"nope": 1}
            )

    def test_a_compatible_selection_is_stored_from_the_registry(
        self, session: Session
    ) -> None:
        """The stored value is rebuilt from the row, never trusted from the caller."""
        user, collection = self._collection(session)
        index = models.RegisteredIndex(
            user_id=user.id,
            backend=IndexBackend.PGVECTOR,
            name="local-sparse",
            vector_type="sparse",
        )
        session.add(index)
        session.commit()
        session.refresh(index)

        values = resolve_binding_values(
            session,
            user,
            collection,
            _facet_definition(),
            {
                "bm25_index": {
                    "index_id": str(index.id),
                    "backend": "pinecone",  # a lie the registry overrides
                    "name": "not-this-name",
                }
            },
        )

        assert values["bm25_index"] == {
            "index_id": str(index.id),
            "backend": "pgvector",
            "name": "local-sparse",
        }


def test_binding_context_resolves_the_definition_per_collection() -> None:
    """Two bindings, one definition, different resolved backends."""
    definition = _facet_definition()

    pinned = resolve_static_definition(
        definition,
        binding=BindingContext(
            collection=CollectionScope.placeholder(),
            values={
                "bm25_index": {
                    "index_id": str(uuid4()),
                    "backend": "pinecone",
                    "name": "remote",
                }
            },
        ),
    )

    assert pinned.node_map()["facet"].config["backend"] == "pinecone"
    assert pinned.node_map()["facet"].config["index_name"] == "remote"
