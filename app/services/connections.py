"""Provider-connection management: CRUD, validation, and redacted reads.

The service is the single place connection configs are validated (through the
provider type's config model, via the adapter registry) and the single place
secrets are redacted for the wire: `ConnectionRead.config` carries only
non-secret values, with secret fields echoed as `secrets_configured` booleans.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.pgvector_support import pgvector_available
from app.db.repositories import ProviderConnectionRepository
from app.providers.base import ProviderAdapter, ProviderDescriptor
from app.providers.registry import (
    ADAPTERS,
    all_descriptors,
    build_adapter,
    invalidate_connection_caches,
    invalidate_embedding_dimensions,
    resolve_connection,
)
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.provider_errors import ProviderErrorCode, ProviderErrorDetail
from app.schemas.providers import (
    ConfigFieldKind,
    ConnectionCreate,
    ConnectionRead,
    ConnectionUpdate,
    ConnectionValidationResult,
    ProviderCoverage,
    ProviderTypeRead,
)
from app.services.errors import InvalidInputError, ServiceError, is_external_provider_error

PGVECTOR_BUILTIN_TYPE = "pgvector"
logger = logging.getLogger(__name__)


def is_usable(connection: models.ProviderConnection) -> bool:
    """Whether a connection may satisfy a capability gate.

    A row saved past a failed test has never been reached, so nothing has
    confirmed what it serves. `connection_kinds` falls back to the provider
    type's *declared* kinds when the probe fails, and a declared set can be
    wider than the server's — a TEI descriptor declares embedding and
    reranking where a TEI server serves exactly one. Counting an unverified
    row would let the setup wizard complete, and the pickers offer a model,
    for a capability nobody has established exists.
    """
    return connection.last_validated_at is not None


def _unreachable_error(message: str | None) -> InvalidInputError:
    """The 400 raised when a save's live probe fails.

    Carries the shared `ProviderErrorDetail` shape so the client can tell this
    apart from the other 400s these routes raise (unknown provider type, the
    per-user connection cap) and offer to save anyway. A structural failure
    stays a plain-string 400: there is nothing to confirm past a missing
    required field.
    """
    return InvalidInputError(
        ProviderErrorDetail(
            code=ProviderErrorCode.CONNECTION,
            message=message or "Connection validation failed.",
            retryable=True,
        ).model_dump(mode="json")
    )


def connection_kinds(adapter: ProviderAdapter) -> tuple[ProviderKind, ...]:
    """Return actual capabilities, retaining Settings access during outages.

    The one answer to "what does this connection serve". A caller reading the
    *descriptor* instead gets what the provider type could serve, which for a
    custom server is every kind it might be configured for — so an
    embeddings-only server reads as a chat provider too.
    """
    try:
        return adapter.kinds
    except Exception as exc:
        if not (is_external_provider_error(exc) or isinstance(exc, ServiceError)):
            raise
        logger.warning(
            "Capability discovery failed for provider connection %s.",
            adapter.connection.id,
            exc_info=True,
        )
        return adapter.descriptor.kinds


def provider_type_catalog() -> list[ProviderTypeRead]:
    """The provider-type catalog: registered adapters plus built-ins."""
    catalog = [
        ProviderTypeRead(
            provider_type=descriptor.provider_type.value,
            label=descriptor.label,
            kinds=list(descriptor.kinds),
            config_fields=list(descriptor.config_fields),
            docs_url=descriptor.docs_url,
            max_connections_per_user=descriptor.max_connections_per_user,
            recommended=descriptor.recommended,
        )
        for descriptor in all_descriptors()
    ]
    catalog.append(
        ProviderTypeRead(
            provider_type=PGVECTOR_BUILTIN_TYPE,
            label="pgvector (PostgreSQL)",
            kinds=[ProviderKind.VECTOR_STORE],
            config_fields=[],
            builtin=True,
            available=pgvector_available(),
        )
    )
    return catalog


def _config_value(raw: object) -> str:
    """Render one stored config value for the wire, as a string.

    A boolean is spelled the way JSON spells it, not the way Python's `str`
    does. `ConnectionRead.config` is `dict[str, str]`, and the form reads a
    toggle by comparing to `"true"` — so `"True"` round-trips as *off*, and an
    edit dialog would silently offer to turn off a capability that is already
    on.
    """
    if isinstance(raw, bool):
        return "true" if raw else "false"
    return str(raw)


def connection_to_read(connection: models.ProviderConnection) -> ConnectionRead:
    """Build the redacted wire shape for a connection row."""
    descriptor = ADAPTERS[ProviderType(connection.provider_type)].descriptor
    try:
        adapter: ProviderAdapter | None = build_adapter(connection)
    except InvalidInputError:
        # A row whose stored config no longer validates must still list —
        # rendering from the descriptor keeps it visible and deletable instead
        # of turning the whole listing into a 400.
        logger.warning(
            "Rendering connection %s from its descriptor; stored config is invalid.",
            connection.id,
            exc_info=True,
        )
        adapter = None
    public_config: dict[str, str] = {}
    secrets_configured: dict[str, bool] = {}
    for field in descriptor.config_fields:
        raw = connection.config.get(field.name)
        if field.kind is ConfigFieldKind.SECRET:
            secrets_configured[field.name] = bool(str(raw or "").strip())
        elif raw is not None:
            public_config[field.name] = _config_value(raw)
    return ConnectionRead(
        id=connection.id,
        provider_type=ProviderType(connection.provider_type),
        label=connection.label,
        kinds=list(descriptor.kinds if adapter is None else connection_kinds(adapter)),
        config_valid=adapter is not None,
        last_validated_at=connection.last_validated_at,
        config=public_config,
        secrets_configured=secrets_configured,
        created_at=connection.created_at,
        updated_at=connection.updated_at,
    )


class ConnectionService:
    """Manage a user's provider connections."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.repo = ProviderConnectionRepository(session)

    def list_connections(self, user: models.User) -> list[ConnectionRead]:
        """Return the user's connections, redacted for the wire.

        A row with an unknown provider type (e.g. after a version downgrade)
        is skipped rather than failing the whole listing.
        """
        rows = []
        for row in self.repo.list_for_user(user.id):
            try:
                rows.append(connection_to_read(row))
            except ValueError:
                continue
        return rows

    def coverage(self, user: models.User) -> ProviderCoverage:
        """Which provider kinds the user's connections (plus builtins) cover."""
        kinds: set[ProviderKind] = set()
        if pgvector_available():
            kinds.add(ProviderKind.VECTOR_STORE)
        for row in self.repo.list_for_user(user.id):
            if not is_usable(row):
                continue
            try:
                adapter = build_adapter(row)
            except InvalidInputError:
                continue
            kinds.update(connection_kinds(adapter))
        return ProviderCoverage(
            has_embedding=ProviderKind.EMBEDDING in kinds,
            has_chat=ProviderKind.CHAT in kinds,
            has_reranking=ProviderKind.RERANKING in kinds,
            has_vector_store=ProviderKind.VECTOR_STORE in kinds,
        )

    @staticmethod
    def _descriptor(provider_type: str) -> ProviderDescriptor:
        """Return the descriptor for a stored provider-type string."""
        try:
            resolved = ProviderType(provider_type)
        except ValueError as exc:
            raise InvalidInputError(f"Unknown provider type '{provider_type}'.") from exc
        return ADAPTERS[resolved].descriptor

    def create(self, user: models.User, payload: ConnectionCreate) -> ConnectionRead:
        """Validate and persist a new connection.

        The config is validated twice on purpose: structurally through the
        provider's config model (adapter construction), and live against the
        provider (`validate_connection`) so a typo'd key or unreachable
        server is rejected at save time, not at first use.
        """
        descriptor = self._descriptor(payload.provider_type.value)
        limit = descriptor.max_connections_per_user
        if limit is not None:
            existing = self.repo.list_for_user_of_type(user.id, payload.provider_type.value)
            if len(existing) >= limit:
                raise InvalidInputError(
                    f"Only {limit} {descriptor.label} connection(s) are allowed."
                )
        connection = models.ProviderConnection(
            user_id=user.id,
            provider_type=payload.provider_type.value,
            label=payload.label,
            config=payload.config,
        )
        adapter = build_adapter(connection)
        validated_at = self._probe_for_save(adapter, payload.skip_validation)
        created = self.repo.create(
            user_id=user.id,
            provider_type=payload.provider_type.value,
            label=payload.label,
            # The adapter's model may have rewritten the config (assumed scheme
            # or port); store what the provider is actually reached at.
            config=adapter.normalized_config(),
            last_validated_at=validated_at,
        )
        self.session.commit()
        self.session.refresh(created)
        return connection_to_read(created)

    def update(
        self,
        user: models.User,
        connection_id: UUID,
        payload: ConnectionUpdate,
    ) -> ConnectionRead:
        """Relabel a connection and/or overlay config fields (secret rotation)."""
        connection = resolve_connection(self.session, user, connection_id)
        old_connection = connection.model_copy(deep=True)
        if payload.label is not None:
            connection.label = payload.label
        if payload.config:
            # Reassign, never mutate: JSON columns are not MutableDict-wrapped.
            connection.config = {**connection.config, **payload.config}
            adapter = build_adapter(connection)
            # The config that answered the last probe is gone, so its timestamp
            # is too — a successful probe below re-establishes it.
            connection.last_validated_at = self._probe_for_save(adapter, payload.skip_validation)
            connection.config = adapter.normalized_config()
        self.session.add(connection)
        self.session.commit()
        self.session.refresh(connection)
        self._cleanup_connection_cache(old_connection)
        return connection_to_read(connection)

    @staticmethod
    def _probe_for_save(adapter: ProviderAdapter, skip: bool) -> datetime | None:
        """Probe the config being saved, or record that nobody did.

        Returns the moment the provider answered, or `None` when the caller
        chose to save past a failure — the row is then structurally valid but
        unverified, which capability gates read as unusable until a probe
        succeeds.
        """
        if skip:
            logger.info(
                "Saving %s connection without a live probe; the user chose to save anyway.",
                adapter.descriptor.provider_type,
            )
            return None
        result = adapter.validate_connection()
        if not result.valid:
            raise _unreachable_error(result.message)
        return datetime.now(UTC)

    def delete(self, user: models.User, connection_id: UUID) -> None:
        """Delete a connection; downstream references fail lazily with a clear error."""
        connection = resolve_connection(self.session, user, connection_id)
        old_connection = connection.model_copy(deep=True)
        self.repo.delete(connection)
        self.session.commit()
        self._cleanup_connection_cache(old_connection)

    @staticmethod
    def _cleanup_connection_cache(connection: models.ProviderConnection) -> None:
        """Best-effort cleanup after the database mutation is committed."""
        try:
            invalidate_connection_caches(connection)
            invalidate_embedding_dimensions(connection.id)
        except Exception:
            logger.warning(
                "Cache cleanup failed for provider connection %s.",
                connection.id,
                exc_info=True,
            )

    def validate_unsaved(
        self, provider_type: ProviderType, config: dict[str, object]
    ) -> ConnectionValidationResult:
        """Probe an unsaved connection config before creating it."""
        candidate = models.ProviderConnection(
            user_id=UUID(int=0),
            provider_type=provider_type.value,
            label="unsaved",
            config=dict(config),
        )
        try:
            adapter: ProviderAdapter = build_adapter(candidate)
        except InvalidInputError as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "Invalid configuration."
            return ConnectionValidationResult(valid=False, message=detail)
        return adapter.validate_connection()

    def validate_saved(
        self,
        user: models.User,
        connection_id: UUID,
        draft_config: dict[str, object] | None = None,
    ) -> ConnectionValidationResult:
        """Re-probe a saved connection, optionally with unsaved edits applied.

        `draft_config` overlays the stored config the way `update` does, so the
        dialog can test a moved server URL against the stored API key without
        the user re-typing it. The overlay is probed on a *detached* candidate
        row, never on the tracked one: assigning to the resolved row's `config`
        would dirty it, and any autoflush would then write an unsaved, unprobed
        draft — including a freshly typed secret — to the database.
        """
        connection = resolve_connection(self.session, user, connection_id)
        candidate = connection
        if draft_config is not None:
            candidate = models.ProviderConnection(
                user_id=connection.user_id,
                provider_type=connection.provider_type,
                label=connection.label,
                config={**connection.config, **draft_config},
            )
        try:
            adapter = build_adapter(candidate)
        except InvalidInputError as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "Invalid configuration."
            return ConnectionValidationResult(valid=False, message=detail)
        result = adapter.validate_connection()
        # A probe of the stored config is the one that says the row is good;
        # a draft probe describes edits that are not saved yet, so it must not
        # mark the stored config verified.
        if result.valid and draft_config is None:
            connection.last_validated_at = datetime.now(UTC)
            self.session.add(connection)
            self.session.commit()
        return result
