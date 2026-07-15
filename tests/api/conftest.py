"""HTTP-layer fixtures: a ``TestClient`` wired to the test session.

Route tests that assert the HTTP contract (auth gating, 404 ownership isolation,
422 validation, response serialization) go through these clients rather than
calling the route function directly -- a direct call exercises none of the
things the HTTP layer does (auth dependencies, request validation, response
serialization). The clients override two seams:

- ``get_session`` -> the per-test ``session`` fixture, so rows a test creates are
  the rows the route reads.
- ``get_current_user`` (``client`` only) -> a fixed ``auth_user``, so a request is
  authenticated without minting a JWT. ``unauthed_client`` leaves real auth in
  place so ``401`` behavior is observable.

``TestClient(app)`` is built without the context-manager form on purpose: that
skips the app lifespan (DB bootstrap + pipeline backfill), which the test
session fixture already owns.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session
from app.api.main import app
from app.db import models
from app.db.repositories import UserRepository
from tests.utils.providers import install_default_pipelines as scaffold_default_pipelines


@pytest.fixture(name="auth_user")
def auth_user_fixture(session: Session) -> models.User:
    """Persist and return the user the ``client`` fixture authenticates as.

    Comes with OpenRouter + Pinecone provider connections configured so
    routes that resolve providers behave like a fully onboarded account.
    """
    user = models.User(
        email="owner@example.com",
        full_name="Owner",
        hashed_password="hashed",
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    openrouter = models.ProviderConnection(
        user_id=user.id,
        provider_type="openrouter",
        label="OpenRouter",
        config={"api_key": "openrouter-key"},
    )
    pinecone = models.ProviderConnection(
        user_id=user.id,
        provider_type="pinecone",
        label="Pinecone",
        config={"api_key": "pinecone-key"},
    )
    session.add(openrouter)
    session.add(pinecone)
    session.commit()
    scaffold_default_pipelines(session, user, openrouter)
    session.refresh(user)
    return user


@pytest.fixture(name="client")
def client_fixture(session: Session, auth_user: models.User) -> Iterator[TestClient]:
    """A TestClient authenticated as ``auth_user`` and bound to the test session."""
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_current_user] = lambda: auth_user
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(name="unauthed_client")
def unauthed_client_fixture(session: Session) -> Iterator[TestClient]:
    """A TestClient with real auth (no token) but the test session for the DB."""
    app.dependency_overrides[get_session] = lambda: session
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
