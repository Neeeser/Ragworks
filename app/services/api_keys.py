"""Issue, list, verify, and revoke scoped API keys.

The secret is generated once, returned once, and stored only as a sha256
digest — a lost key is reissued, never recovered. Verification returns a
typed `KeyPrincipal` (the key row plus its owner) so the MCP transport has one
place to ask "who is this, and what may they touch"; a rejected key raises
`InvalidApiKeyError` carrying the reason, which the transport turns into a 401
without echoing it to the caller.
"""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ApiKeyRepository, CollectionRepository, UserRepository
from app.schemas.api_keys import ApiKeyCreate, ApiKeyRead
from app.schemas.enums import ApiKeyCapability
from app.services.errors import InvalidInputError, NotFoundError
from app.utils.time import ensure_utc, utc_now

#: Capabilities that each capability grants along with itself.
#:
#: `files:write` implies `files:read`: an agent that may upload or delete has to
#: be able to find what it is acting on, and a write-only key would advertise
#: `delete_file` while withholding `list_files` — a tool set unusable without
#: guessing paths.
CAPABILITY_IMPLIES: dict[ApiKeyCapability, frozenset[ApiKeyCapability]] = {
    ApiKeyCapability.FILES_WRITE: frozenset({ApiKeyCapability.FILES_READ}),
}

#: Human-recognizable secret prefix, so a leaked string is identifiable.
SECRET_PREFIX = "rw_"
#: Bytes of entropy behind each secret (43 url-safe characters).
_SECRET_BYTES = 32
#: Characters of the secret kept in cleartext for display (`rw_` + 8).
_DISPLAY_CHARS = 8


class InvalidApiKeyError(Exception):
    """An API key was absent, unknown, revoked, expired, or inactive.

    Never surfaced to the caller: the transport answers every case with the
    same 401 so a probe cannot distinguish "unknown key" from "revoked key".
    `reason` exists for the server-side log.
    """

    def __init__(self, reason: str) -> None:
        """Record why the key was rejected."""
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class KeyPrincipal:
    """An authenticated API key and its owner."""

    api_key: models.ApiKey
    user: models.User

    def has(self, capability: ApiKeyCapability) -> bool:
        """Return whether the key was provisioned for a capability."""
        return capability.value in self.api_key.capabilities

    def capabilities(self) -> frozenset[ApiKeyCapability]:
        """Return the key's capabilities, ignoring any unknown stored values.

        An unknown value means the row was written by a newer version; it is
        skipped rather than raising, so a downgrade cannot lock out a key.
        """
        known = {member.value: member for member in ApiKeyCapability}
        return frozenset(
            known[value] for value in self.api_key.capabilities if value in known
        )

    def reaches_collection(self, collection_id: UUID) -> bool:
        """Return whether the key's scope includes a collection."""
        return str(collection_id) in self.api_key.collection_ids


def expand_capabilities(
    capabilities: Iterable[ApiKeyCapability],
) -> list[ApiKeyCapability]:
    """Return the requested capabilities plus everything they imply.

    Resolved to a fixpoint so a future chained implication cannot silently
    under-grant, and ordered by the enum's declaration so a stored list does not
    depend on the order the caller asked in.
    """
    granted = set(capabilities)
    while True:
        expanded = granted | {
            implied
            for capability in granted
            for implied in CAPABILITY_IMPLIES.get(capability, frozenset())
        }
        if expanded == granted:
            break
        granted = expanded
    return [member for member in ApiKeyCapability if member in granted]


def digest_secret(secret: str) -> str:
    """Return the storage digest for a plaintext secret."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def to_api_key_read(api_key: models.ApiKey) -> ApiKeyRead:
    """Project a key row onto its wire shape (never the secret)."""
    return ApiKeyRead(
        id=api_key.id,
        name=api_key.name,
        prefix=api_key.prefix,
        capabilities=[
            ApiKeyCapability(value)
            for value in api_key.capabilities
            if value in {member.value for member in ApiKeyCapability}
        ],
        collection_ids=[UUID(value) for value in api_key.collection_ids],
        created_at=ensure_utc(api_key.created_at),
        last_used_at=ensure_utc(api_key.last_used_at) if api_key.last_used_at else None,
        expires_at=ensure_utc(api_key.expires_at) if api_key.expires_at else None,
        revoked_at=ensure_utc(api_key.revoked_at) if api_key.revoked_at else None,
    )


class ApiKeyService:
    """Lifecycle for one user's API keys."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.keys = ApiKeyRepository(session)
        self.collections = CollectionRepository(session)

    def list_keys(self, user: models.User) -> list[models.ApiKey]:
        """Return the user's keys, newest first."""
        return self.keys.list_for_user(user.id)

    def issue(self, user: models.User, payload: ApiKeyCreate) -> tuple[models.ApiKey, str]:
        """Create a key and return it with its one-time plaintext secret.

        Implied capabilities are expanded before storage, not at read time, so
        the row and every listing state exactly what the key can do. This is the
        only write path, so a direct API call is normalized too.
        """
        collection_ids = self._validated_collection_ids(user, payload)
        secret = f"{SECRET_PREFIX}{secrets.token_urlsafe(_SECRET_BYTES)}"
        expires_at = (
            utc_now() + timedelta(days=payload.expires_in_days)
            if payload.expires_in_days is not None
            else None
        )
        api_key = self.keys.add(
            models.ApiKey(
                user_id=user.id,
                name=payload.name.strip(),
                prefix=secret[: len(SECRET_PREFIX) + _DISPLAY_CHARS],
                token_digest=digest_secret(secret),
                capabilities=[
                    capability.value
                    for capability in expand_capabilities(payload.capabilities)
                ],
                collection_ids=[str(value) for value in collection_ids],
                expires_at=expires_at,
            )
        )
        return api_key, secret

    def revoke(self, user: models.User, key_id: UUID) -> models.ApiKey:
        """Revoke one of the user's keys, keeping the row as an audit record."""
        api_key = self.keys.get_owned(key_id, user.id)
        if api_key is None:
            raise NotFoundError("API key not found")
        if api_key.revoked_at is None:
            self.keys.revoke(api_key, utc_now())
        return api_key

    def verify(self, secret: str) -> KeyPrincipal:
        """Resolve a plaintext secret to its principal or raise.

        Every rejection raises the same error type; the distinct reasons exist
        for logs, never for the response body.
        """
        if not secret or not secret.startswith(SECRET_PREFIX):
            raise InvalidApiKeyError("malformed")
        api_key = self.keys.get_by_digest(digest_secret(secret))
        if api_key is None:
            raise InvalidApiKeyError("unknown")
        if api_key.revoked_at is not None:
            raise InvalidApiKeyError("revoked")
        if api_key.expires_at is not None and ensure_utc(api_key.expires_at) <= utc_now():
            raise InvalidApiKeyError("expired")
        user = UserRepository(self.session).get(api_key.user_id)
        if user is None or not user.is_active:
            raise InvalidApiKeyError("inactive_user")
        return KeyPrincipal(api_key=api_key, user=user)

    def record_use(self, api_key: models.ApiKey) -> None:
        """Stamp a key's last use (committed by the caller)."""
        self.keys.touch_last_used(api_key.id, utc_now())

    def _validated_collection_ids(
        self, user: models.User, payload: ApiKeyCreate
    ) -> list[UUID]:
        """Return the key's collection scope, rejecting an unusable one.

        Every id must be a collection the user actually owns. Silently dropping
        an unknown one would hand back a key whose scope differs from the one
        the caller asked for.
        """
        requested = list(dict.fromkeys(payload.collection_ids))
        owned = {
            collection.id
            for collection in self.collections.list_by_ids(user.id, requested)
        }
        missing = [str(value) for value in requested if value not in owned]
        if missing:
            raise InvalidInputError(f"Unknown collection(s): {', '.join(missing)}")
        return requested
