"""Who points at a registered index, and what that prevents.

Usage is read from *declared* references — a binding's selected index — not
from runs, because a pipeline that has not run yet still owns its index.
Deleting the registration out from under it would leave the pipeline reading a
store nothing in the app admits to owning, which surfaces as empty results
with no error.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.retrieval import VectorRetrieverNode
from app.schemas.enums import IndexBackend
from app.services.errors import InvalidInputError, NotFoundError
from app.services.index_registry import (
    IndexRegistryService,
)


def _definition(name: str = "docs-main") -> PipelineDefinition:
    """A retrieval graph naming its own index."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="retriever",
                type=VectorRetrieverNode.type,
                name="Retriever",
                config={"backend": "pgvector", "index_name": name},
            ),
            PipelineNodeDefinition(id="in", type="retrieval.input", name="In"),
            PipelineNodeDefinition(id="out", type="retrieval.output", name="Out"),
        ]
    )


class _Fixture:
    """One user with a collection, a registered index, and a bound pipeline."""

    def __init__(self, session: Session) -> None:
        self.session = session
        self.user = models.User(
            email="registry@example.com", full_name="R", hashed_password="x"
        )
        session.add(self.user)
        session.commit()
        session.refresh(self.user)

        self.index = models.RegisteredIndex(
            user_id=self.user.id,
            backend=IndexBackend.PGVECTOR,
            name="docs-main",
            vector_type="dense",
            dimension=1536,
        )
        session.add(self.index)
        session.commit()
        session.refresh(self.index)

        self.collection = models.Collection(
            user_id=self.user.id, name="Docs", description="", extra_metadata={}
        )
        session.add(self.collection)
        session.commit()
        session.refresh(self.collection)

    def bind(self, index_name: str = "docs-main") -> models.Pipeline:
        """Persist a pipeline naming the index and bind it to the collection."""
        pipeline = models.Pipeline(user_id=self.user.id, name="Search")
        self.session.add(pipeline)
        self.session.commit()
        self.session.refresh(pipeline)
        version = models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition=_definition(index_name).model_dump(mode="json"),
        )
        self.session.add(version)
        self.session.add(
            models.CollectionPipelineBinding(
                collection_id=self.collection.id,
                pipeline_id=pipeline.id,
                role=models.BindingRole.TOOL,
                is_primary=True,
            )
        )
        self.session.commit()
        return pipeline


class TestUsage:
    """The inverse question: who points at this index?"""

    def test_a_binding_is_reported_as_a_usage(self, session: Session) -> None:
        fixture = _Fixture(session)
        pipeline = fixture.bind()

        usages = IndexRegistryService(session).usages_by_index(fixture.user)

        assert [usage.pipeline.id for usage in usages[fixture.index.id]] == [pipeline.id]
        assert usages[fixture.index.id][0].collection.id == fixture.collection.id

    def test_an_unreferenced_index_has_no_usages(self, session: Session) -> None:
        fixture = _Fixture(session)

        assert IndexRegistryService(session).usages_by_index(fixture.user) == {}

    def test_usage_follows_the_index_the_graph_names(self, session: Session) -> None:
        """Usage is read from the definition, the only place an index is chosen."""
        """Usage follows what the binding actually selected, not the default."""
        fixture = _Fixture(session)
        other = models.RegisteredIndex(
            user_id=fixture.user.id,
            backend=IndexBackend.PGVECTOR,
            name="other-index",
            vector_type="dense",
        )
        session.add(other)
        session.commit()
        session.refresh(other)
        fixture.bind(index_name="other-index")

        usages = IndexRegistryService(session).usages_by_index(fixture.user)

        assert other.id in usages
        assert fixture.index.id not in usages


class TestDeletionGuard:
    """A registration a pipeline targets cannot be removed."""

    def test_unregister_is_refused_while_a_binding_points_at_it(
        self, session: Session
    ) -> None:
        fixture = _Fixture(session)
        fixture.bind()
        service = IndexRegistryService(session)

        with pytest.raises(InvalidInputError) as error:
            service.unregister(fixture.user, fixture.index)

        # The message names the collections, so the user knows where to look.
        assert "Docs" in str(error.value)

    def test_unregister_succeeds_once_nothing_points_at_it(
        self, session: Session
    ) -> None:
        fixture = _Fixture(session)
        service = IndexRegistryService(session)

        service.unregister(fixture.user, fixture.index)

        with Session(session.get_bind()) as fresh:
            assert fresh.get(models.RegisteredIndex, fixture.index.id) is None

    def test_another_users_index_is_not_found(self, session: Session) -> None:
        """Ownership is a 404, never a leak of someone else's index."""
        fixture = _Fixture(session)
        stranger = models.User(
            email="stranger@example.com", full_name="S", hashed_password="x"
        )
        session.add(stranger)
        session.commit()
        session.refresh(stranger)

        with pytest.raises(NotFoundError):
            IndexRegistryService(session).get(stranger, fixture.index.id)


def test_register_is_idempotent_for_one_identity(session: Session) -> None:
    """Two pipelines naming one index share a row — the point of the entity."""
    fixture = _Fixture(session)
    service = IndexRegistryService(session)

    first = service.register(fixture.user, IndexBackend.PGVECTOR, "shared")
    second = service.register(fixture.user, IndexBackend.PGVECTOR, "shared")

    assert first.id == second.id


def test_a_binding_whose_pipeline_has_no_version_is_skipped(session: Session) -> None:
    """Usage listing degrades past a broken binding instead of failing.

    An index's "used by" list is read on the manager's delete path, so one
    unresolvable binding must not make every index look unused — or, worse,
    make the listing 500.
    """
    fixture = _Fixture(session)
    fixture.bind()
    # A second binding whose pipeline has no version at all.
    orphan = models.Pipeline(user_id=fixture.user.id, name="No versions")
    session.add(orphan)
    session.commit()
    session.refresh(orphan)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=fixture.collection.id,
            pipeline_id=orphan.id,
            role=models.BindingRole.TOOL,
        )
    )
    session.commit()

    usages = IndexRegistryService(session).usages_by_index(fixture.user)

    assert fixture.index.id in usages
