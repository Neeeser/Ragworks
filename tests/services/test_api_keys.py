"""API key issuance, verification, and scoping rules.

The security-critical properties live here: the plaintext secret is never
recoverable from storage, an unusable scope is rejected at issuance rather than
silently narrowed, and verification refuses revoked, expired, and
foreign-user keys.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import ApiKeyRepository, UserRepository
from app.schemas.api_keys import ApiKeyCreate
from app.schemas.collections import CollectionCreate
from app.schemas.enums import ApiKeyCapability
from app.services.api_keys import (
    SECRET_PREFIX,
    ApiKeyService,
    InvalidApiKeyError,
    digest_secret,
)
from app.services.collections import CollectionService
from app.services.errors import InvalidInputError, NotFoundError
from app.utils.time import utc_now
from tests.utils.providers import install_default_pipelines


@pytest.fixture(name="user")
def user_fixture(session: Session) -> models.User:
    user = models.User(email="keys@example.com", full_name="K", hashed_password="hashed")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    session.commit()
    return user


def _collection(session: Session, user: models.User, name: str) -> models.Collection:
    collection = CollectionService(session).create(
        user, CollectionCreate(name=name, description="")
    )
    session.commit()
    return collection


def test_issued_secret_is_stored_only_as_a_digest(
    session: Session, user: models.User
) -> None:
    collection = _collection(session, user, "Notes")

    api_key, secret = ApiKeyService(session).issue(
        user,
        ApiKeyCreate(
            name="harness",
            capabilities=[ApiKeyCapability.TOOLS_INVOKE],
            collection_ids=[collection.id],
        ),
    )
    session.commit()

    assert secret.startswith(SECRET_PREFIX)
    with Session(session.get_bind()) as fresh:
        stored = ApiKeyRepository(fresh).get_owned(api_key.id, user.id)
        assert stored is not None
        assert stored.token_digest == digest_secret(secret)
        assert secret not in stored.token_digest
        # The display prefix is a recognizable fragment, never a usable key.
        assert stored.prefix != secret
        assert secret.startswith(stored.prefix)


def test_issuing_without_a_collection_scope_is_rejected(
    session: Session, user: models.User
) -> None:
    """A key that reaches nothing is a configuration error, not a valid key."""
    with pytest.raises(InvalidInputError):
        ApiKeyService(session).issue(
            user,
            ApiKeyCreate(
                name="scopeless", capabilities=[ApiKeyCapability.TOOLS_INVOKE]
            ),
        )


def test_issuing_with_another_users_collection_is_rejected(
    session: Session, user: models.User
) -> None:
    """Never silently drop an id: the caller must get the scope they asked for."""
    stranger = models.User(email="other@example.com", full_name="O", hashed_password="h")
    UserRepository(session).add(stranger)
    session.commit()
    session.refresh(stranger)
    install_default_pipelines(session, stranger)
    theirs = _collection(session, stranger, "Theirs")

    with pytest.raises(InvalidInputError):
        ApiKeyService(session).issue(
            user,
            ApiKeyCreate(
                name="overreaching",
                capabilities=[ApiKeyCapability.TOOLS_INVOKE],
                collection_ids=[theirs.id],
            ),
        )


def test_verify_returns_a_principal_carrying_scope(
    session: Session, user: models.User
) -> None:
    collection = _collection(session, user, "Notes")
    other = _collection(session, user, "Other")
    service = ApiKeyService(session)
    _, secret = service.issue(
        user,
        ApiKeyCreate(
            name="harness",
            capabilities=[ApiKeyCapability.TOOLS_INVOKE, ApiKeyCapability.FILES_READ],
            collection_ids=[collection.id],
        ),
    )
    session.commit()

    principal = service.verify(secret)

    assert principal.user.id == user.id
    assert principal.has(ApiKeyCapability.FILES_READ)
    assert not principal.has(ApiKeyCapability.FILES_WRITE)
    assert principal.reaches_collection(collection.id)
    assert not principal.reaches_collection(other.id)


def test_verify_rejects_unknown_revoked_and_expired_keys(
    session: Session, user: models.User
) -> None:
    collection = _collection(session, user, "Notes")
    service = ApiKeyService(session)
    revoked, revoked_secret = service.issue(
        user,
        ApiKeyCreate(
            name="revoked",
            capabilities=[ApiKeyCapability.TOOLS_INVOKE],
            collection_ids=[collection.id],
        ),
    )
    expiring, expiring_secret = service.issue(
        user,
        ApiKeyCreate(
            name="expiring",
            capabilities=[ApiKeyCapability.TOOLS_INVOKE],
            collection_ids=[collection.id],
            expires_in_days=1,
        ),
    )
    session.commit()
    service.revoke(user, revoked.id)
    expiring.expires_at = utc_now() - timedelta(minutes=1)
    session.add(expiring)
    session.commit()

    for secret in (f"{SECRET_PREFIX}nonexistent", revoked_secret, expiring_secret, "plain"):
        with pytest.raises(InvalidApiKeyError):
            service.verify(secret)


def test_verify_rejects_a_key_whose_owner_is_deactivated(
    session: Session, user: models.User
) -> None:
    collection = _collection(session, user, "Notes")
    service = ApiKeyService(session)
    _, secret = service.issue(
        user,
        ApiKeyCreate(
            name="harness",
            capabilities=[ApiKeyCapability.TOOLS_INVOKE],
            collection_ids=[collection.id],
        ),
    )
    session.commit()
    user.is_active = False
    session.add(user)
    session.commit()

    with pytest.raises(InvalidApiKeyError):
        service.verify(secret)


def test_revoking_another_users_key_is_not_found(
    session: Session, user: models.User
) -> None:
    stranger = models.User(email="third@example.com", full_name="T", hashed_password="h")
    UserRepository(session).add(stranger)
    session.commit()
    session.refresh(stranger)
    install_default_pipelines(session, stranger)
    theirs = _collection(session, stranger, "Theirs")
    key, _ = ApiKeyService(session).issue(
        stranger,
        ApiKeyCreate(
            name="theirs",
            capabilities=[ApiKeyCapability.TOOLS_INVOKE],
            collection_ids=[theirs.id],
        ),
    )
    session.commit()

    with pytest.raises(NotFoundError):
        ApiKeyService(session).revoke(user, key.id)


def test_capabilities_ignores_values_a_newer_version_wrote(
    session: Session, user: models.User
) -> None:
    """A downgrade must not lock a key out over an unrecognized capability."""
    collection = _collection(session, user, "Notes")
    service = ApiKeyService(session)
    api_key, secret = service.issue(
        user,
        ApiKeyCreate(
            name="future",
            capabilities=[ApiKeyCapability.TOOLS_INVOKE],
            collection_ids=[collection.id],
        ),
    )
    api_key.capabilities = ["tools:invoke", "evals:run"]
    session.add(api_key)
    session.commit()

    principal = service.verify(secret)

    assert principal.capabilities() == frozenset({ApiKeyCapability.TOOLS_INVOKE})
