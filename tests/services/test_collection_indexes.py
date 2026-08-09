"""What a collection reports about the indexes its pipelines name.

Read-only by design: a pipeline names the index it uses, so there is nothing
here to choose. The contract worth pinning is that the collection can always
answer "where does my data live", merged across every binding, and that a
broken binding degrades instead of sinking the page.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.schemas.collections import CollectionCreate
from app.services.collection_indexes import CollectionIndexService
from app.services.collections import CollectionService
from tests.utils.collections import scaffolded_pair
from tests.utils.providers import install_scaffolded_pipelines


def _user(session: Session) -> models.User:
    user = models.User(
        email="indexes@example.com", full_name="Indexes", hashed_password="x"
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_scaffolded_pipelines(session, user)
    return user


def _collection(session: Session, user: models.User) -> models.Collection:
    ingest, search = scaffolded_pair(session, user)
    return CollectionService(session).create(
        user,
        CollectionCreate(
            name="Indexes",
            description="",
            ingest_pipeline_id=ingest.id,
            tool_pipeline_ids=[search.id],
        ),
    )


def test_read_reports_both_planes_with_the_pipelines_that_write_them(
    session: Session,
) -> None:
    user = _user(session)
    collection = _collection(session, user)

    result = CollectionIndexService(session).read(user, collection)

    targets = {target.name: target for target in result.targets}
    dense = next(target for target in result.targets if target.vector_type == "dense")
    sparse = next(target for target in result.targets if target.vector_type == "sparse")
    assert dense.pipelines
    assert sparse.pipelines
    # One entry per index, however many bound graphs name it — the ingest and
    # search pipelines share a store and must not double-report it.
    assert len(targets) == len(result.targets)


def test_dense_before_sparse(session: Session) -> None:
    """The semantic store leads: it is the one a reader is looking for."""
    user = _user(session)
    collection = _collection(session, user)

    result = CollectionIndexService(session).read(user, collection)

    assert next(target.vector_type for target in result.targets) == "dense"


def test_a_collection_with_no_bindings_reports_nothing(session: Session) -> None:
    user = _user(session)
    bare = models.Collection(
        user_id=user.id, name="Bare", description="", extra_metadata={}
    )
    session.add(bare)
    session.commit()
    session.refresh(bare)

    assert CollectionIndexService(session).read(user, bare).targets == []


def test_a_binding_whose_pipeline_has_no_version_is_skipped(session: Session) -> None:
    """A pipeline with no readable definition degrades, never sinks the page."""
    user = _user(session)
    collection = _collection(session, user)
    ghost = models.Pipeline(user_id=user.id, name="Ghost")
    session.add(ghost)
    session.commit()
    session.refresh(ghost)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=ghost.id,
            role=models.BindingRole.TOOL,
            position=9,
        )
    )
    session.commit()

    result = CollectionIndexService(session).read(user, collection)

    # The healthy bindings still report; the unreadable one contributes nothing.
    assert result.targets
    assert "Ghost" not in {name for target in result.targets for name in target.pipelines}
