"""Collection tool bindings: scaffolding, fitness rules, primary/enabled rules.

These pin the binding invariants the schema deliberately does not enforce:
at most one ingest binding per collection, exactly one primary among tool
bindings, and bind-time fitness (an ingest binding needs a document-accepting
graph; a tool binding needs a callable one).
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository, UserRepository
from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.services.collection_tools import CollectionToolService
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipeline_resolution import (
    PipelineResolutionError,
    resolve_ingest_binding,
    resolve_primary_tool,
)
from app.services.pipelines import PipelineService
from tests.utils.providers import install_default_pipelines


def _create_user(session: Session, email: str = "tools@example.com") -> models.User:
    user = models.User(email=email, full_name="User", hashed_password="hashed")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name="Collection", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _create_search_pipeline(
    session: Session, user: models.User, name: str = "Extra Search"
) -> models.Pipeline:
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name=name,
        definition=build_default_retrieval_pipeline(
            embedding_connection_id=uuid4(), embedding_model="test-embed"
        ),
        change_summary="Test tool pipeline.",
    )
    session.commit()
    session.refresh(pipeline)
    return pipeline


class TestScaffolding:
    def test_resolving_an_unbound_collection_scaffolds_default_bindings(
        self, session: Session
    ) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)

        resolved = resolve_ingest_binding(session, user, collection)

        assert resolved.binding.role == models.BindingRole.INGEST
        bindings = CollectionPipelineBindingRepository(session).list_for_collection(
            collection.id
        )
        roles = sorted(str(models.BindingRole(binding.role).value) for binding in bindings)
        assert roles == ["ingest", "tool"]
        tool = next(b for b in bindings if b.role == models.BindingRole.TOOL)
        assert tool.is_primary is True

    def test_read_only_resolution_never_scaffolds(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)

        with pytest.raises(PipelineResolutionError):
            resolve_ingest_binding(session, user, collection, scaffold=False)
        assert (
            CollectionPipelineBindingRepository(session).list_for_collection(collection.id)
            == []
        )

    def test_primary_tool_resolution_returns_settings_and_interface(
        self, session: Session
    ) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)

        resolved = resolve_primary_tool(session, user, collection)

        assert resolved.binding.is_primary is True
        assert resolved.interface.callable is True
        assert resolved.settings.index_targets


class TestBindingRules:
    def test_tool_binding_requires_a_callable_pipeline(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        service = CollectionToolService(session)
        ingestion_only = PipelineService(session).create_pipeline(
            user=user,
            name="Ingest Only",
            definition=build_default_ingestion_pipeline(
                embedding_connection_id=uuid4(), embedding_model="test-embed"
            ),
        )
        session.commit()

        with pytest.raises(InvalidInputError):
            service.add_tool(user, collection, ingestion_only.id)

    def test_ingest_binding_requires_a_document_accepting_pipeline(
        self, session: Session
    ) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        search = _create_search_pipeline(session, user)

        with pytest.raises(InvalidInputError):
            CollectionToolService(session).set_ingest_pipeline(user, collection, search.id)

    def test_first_tool_becomes_primary_and_set_primary_moves_the_flag(
        self, session: Session
    ) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        service = CollectionToolService(session)
        first = service.add_tool(user, collection, _create_search_pipeline(session, user).id)
        second = service.add_tool(
            user, collection, _create_search_pipeline(session, user, "Second Search").id
        )
        session.commit()
        assert first.is_primary is True
        assert second.is_primary is False

        service.set_primary(user, collection, second.id)
        session.commit()

        repo = CollectionPipelineBindingRepository(session)
        primaries = [
            binding
            for binding in repo.list_for_collection(
                collection.id, role=models.BindingRole.TOOL
            )
            if binding.is_primary
        ]
        assert [binding.id for binding in primaries] == [second.id]

    def test_removing_the_primary_promotes_the_next_tool(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        service = CollectionToolService(session)
        first = service.add_tool(user, collection, _create_search_pipeline(session, user).id)
        second = service.add_tool(
            user, collection, _create_search_pipeline(session, user, "Second Search").id
        )
        session.commit()

        service.remove_tool(user, collection, first.id)
        session.commit()

        repo = CollectionPipelineBindingRepository(session)
        remaining = repo.list_for_collection(collection.id, role=models.BindingRole.TOOL)
        assert [binding.id for binding in remaining] == [second.id]
        assert remaining[0].is_primary is True

    def test_unknown_binding_is_not_found(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)

        with pytest.raises(NotFoundError):
            CollectionToolService(session).set_primary(user, collection, uuid4())

    def test_foreign_pipeline_cannot_be_bound(self, session: Session) -> None:
        user = _create_user(session)
        other = _create_user(session, email="other@example.com")
        foreign = _create_search_pipeline(session, other)
        collection = _create_collection(session, user)

        with pytest.raises(NotFoundError):
            CollectionToolService(session).add_tool(user, collection, foreign.id)

    def test_disabled_tools_are_excluded_from_enabled_listing(
        self, session: Session
    ) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        service = CollectionToolService(session)
        binding = service.add_tool(
            user, collection, _create_search_pipeline(session, user).id
        )
        session.commit()

        service.set_enabled(user, collection, binding.id, enabled=False)
        session.commit()

        enabled = service.list_enabled_tools(collection)
        assert enabled == []


class TestPurgeTargets:
    def test_purge_targets_union_and_skip_unresolvable_tools(
        self, session: Session
    ) -> None:
        """Purge targets union every binding's indexes; a tool binding whose
        graph no longer fits (not callable) is skipped rather than blocking
        deletion."""
        from app.services.pipeline_resolution import resolve_purge_targets

        user = _create_user(session)
        collection = _create_collection(session, user)
        resolve_ingest_binding(session, user, collection)  # scaffold defaults
        broken = PipelineService(session).create_pipeline(
            user=user,
            name="Not Callable",
            definition=build_default_ingestion_pipeline(
                embedding_connection_id=uuid4(), embedding_model="test-embed"
            ),
        )
        session.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=broken.id,
                role=models.BindingRole.TOOL,
                position=5,
            )
        )
        session.commit()

        targets = resolve_purge_targets(session, user, collection)

        names = {item.target.index_name for item in targets}
        assert names  # ingest + primary tool targets resolved
        assert all(item.namespace for item in targets)


class TestIngestRebinding:
    def test_set_ingest_pipeline_rebinds_the_existing_row(
        self, session: Session
    ) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        service = CollectionToolService(session)
        resolve_ingest_binding(session, user, collection)  # scaffold defaults
        replacement = PipelineService(session).create_pipeline(
            user=user,
            name="Replacement Ingest",
            definition=build_default_ingestion_pipeline(
                embedding_connection_id=uuid4(), embedding_model="test-embed"
            ),
        )
        session.commit()

        binding = service.set_ingest_pipeline(user, collection, replacement.id)
        session.commit()

        rows = CollectionPipelineBindingRepository(session).list_for_collection(
            collection.id, role=models.BindingRole.INGEST
        )
        assert [row.id for row in rows] == [binding.id]
        assert rows[0].pipeline_id == replacement.id

    def test_set_ingest_pipeline_rejects_unknown_pipeline(
        self, session: Session
    ) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)

        with pytest.raises(NotFoundError):
            CollectionToolService(session).set_ingest_pipeline(user, collection, uuid4())


class TestResolutionEdges:
    def test_binding_to_a_foreign_pipeline_fails_resolution(
        self, session: Session
    ) -> None:
        """A binding row pointing at a pipeline the user cannot see (another
        user's) resolves to a clear domain error, never a 500."""
        from app.services.pipeline_resolution import resolve_tool_binding

        user = _create_user(session)
        other = _create_user(session, email="edge-other@example.com")
        foreign_pipeline = _create_search_pipeline(session, other)
        collection = _create_collection(session, user)
        binding = models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=foreign_pipeline.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
        session.add(binding)
        session.commit()
        session.refresh(binding)

        with pytest.raises(PipelineResolutionError, match="could not be resolved"):
            resolve_tool_binding(session, user, collection, binding.id)

    def test_primary_resolution_falls_back_to_the_first_tool(
        self, session: Session
    ) -> None:
        """A collection whose tool rows carry no primary flag (hand-edited or
        pre-rule data) still resolves: the first tool serves as primary."""
        user = _create_user(session)
        collection = _create_collection(session, user)
        pipeline = _create_search_pipeline(session, user)
        session.add(
            models.CollectionPipelineBinding(
                collection_id=collection.id,
                pipeline_id=pipeline.id,
                role=models.BindingRole.TOOL,
                is_primary=False,
            )
        )
        session.commit()

        resolved = resolve_primary_tool(session, user, collection)

        assert resolved.pipeline.id == pipeline.id
