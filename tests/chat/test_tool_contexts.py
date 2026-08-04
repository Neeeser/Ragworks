"""Cross-collection tool-name dedup in one chat turn.

Two DIFFERENT collections sharing a base tool name (both default to
"search", or otherwise share a resulting slug) is legal and common -- the
bind-time reject added alongside this test only refuses a collision *within*
one collection (see `tests/services/test_collection_tools.py`). When one
chat turn loads several collections at once, their exposed names can still
collide, so `tool_contexts_for_collections` keeps its `_N` suffix dedup;
these tests pin that it still runs.
"""

from __future__ import annotations

from sqlmodel import Session

from app.chat.tool_contexts import tool_contexts_for_collections
from app.db import models
from app.services.pipeline_resolution import resolve_ingest_binding
from tests.utils.providers import install_default_pipelines


def _user(session: Session) -> models.User:
    user = models.User(email="tool-contexts@example.com", full_name="TC", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def _collection(session: Session, user: models.User, name: str) -> models.Collection:
    collection = models.Collection(
        user_id=user.id, name=name, description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    # Scaffolds both the ingest binding and the collection's own default
    # "search" tool binding -- exactly what a real collection has on
    # creation, without a bind-time collision (each collection gets its own
    # single default tool, so there is nothing for `add_tool` to reject).
    resolve_ingest_binding(session, user, collection)
    return collection


def test_two_collections_with_the_same_name_dedup_their_shared_tool_name(
    session: Session,
) -> None:
    """Same collection name -> same exposed slug -> same base tool name."""
    user = _user(session)
    first = _collection(session, user, "Reports")
    second = _collection(session, user, "Reports")

    contexts = tool_contexts_for_collections(session, user, [first, second])

    names = [tool.tool_name for context in contexts for tool in context.tools]
    assert names == ["search_reports", "search_reports_2"]


def test_two_collections_with_different_names_do_not_collide(session: Session) -> None:
    """The common case: distinct collection names need no suffix at all."""
    user = _user(session)
    first = _collection(session, user, "Alpha Corpus")
    second = _collection(session, user, "Beta Corpus")

    contexts = tool_contexts_for_collections(session, user, [first, second])

    names = [tool.tool_name for context in contexts for tool in context.tools]
    assert names == ["search_alpha_corpus", "search_beta_corpus"]
