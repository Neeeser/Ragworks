"""Provider-connection management: CRUD, validation, and redacted reads.

The service is the single place connection configs are validated (through the
provider type's config model, via the adapter registry) and the single place
secrets are redacted for the wire: `ConnectionRead.config` carries only
non-secret values, with secret fields echoed as `secrets_configured` booleans.
"""

from __future__ import annotations

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
    resolve_connection,
)
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.providers import (
    ConfigFieldKind,
    ConnectionCreate,
    ConnectionRead,
    ConnectionUpdate,
    ConnectionValidationResult,
    ProviderCoverage,
    ProviderTypeRead,
)
from app.services.errors import InvalidInputError

PGVECTOR_BUILTIN_TYPE = "pgvector"


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


def connection_to_read(connection: models.ProviderConnection) -> ConnectionRead:
    """Build the redacted wire shape for a connection row."""
    descriptor = ADAPTERS[ProviderType(connection.provider_type)].descriptor
    public_config: dict[str, str] = {}
    secrets_configured: dict[str, bool] = {}
    for field in descriptor.config_fields:
        raw = connection.config.get(field.name)
        if field.kind is ConfigFieldKind.SECRET:
            secrets_configured[field.name] = bool(str(raw or "").strip())
        elif raw is not None:
            public_config[field.name] = str(raw)
    return ConnectionRead(
        id=connection.id,
        provider_type=ProviderType(connection.provider_type),
        label=connection.label,
        kinds=list(descriptor.kinds),
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
        """Return the user's connections, redacted for the wire."""
        return [connection_to_read(row) for row in self.repo.list_for_user(user.id)]

    def coverage(self, user: models.User) -> ProviderCoverage:
        """Which provider kinds the user's connections (plus builtins) cover."""
        kinds: set[ProviderKind] = set()
        if pgvector_available():
            kinds.add(ProviderKind.VECTOR_STORE)
        for row in self.repo.list_for_user(user.id):
            try:
                descriptor = self._descriptor(row.provider_type)
            except InvalidInputError:
                continue
            kinds.update(descriptor.kinds)
        return ProviderCoverage(
            has_embedding=ProviderKind.EMBEDDING in kinds,
            has_chat=ProviderKind.CHAT in kinds,
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
        result = adapter.validate_connection()
        if not result.valid:
            raise InvalidInputError(result.message or "Connection validation failed.")
        created = self.repo.create(
            user_id=user.id,
            provider_type=payload.provider_type.value,
            label=payload.label,
            config=payload.config,
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
        if payload.label is not None:
            connection.label = payload.label
        if payload.config:
            # Reassign, never mutate: JSON columns are not MutableDict-wrapped.
            connection.config = {**connection.config, **payload.config}
            adapter = build_adapter(connection)
            result = adapter.validate_connection()
            if not result.valid:
                raise InvalidInputError(result.message or "Connection validation failed.")
        self.session.add(connection)
        self.session.commit()
        self.session.refresh(connection)
        return connection_to_read(connection)

    def delete(self, user: models.User, connection_id: UUID) -> None:
        """Delete a connection; downstream references fail lazily with a clear error."""
        connection = resolve_connection(self.session, user, connection_id)
        self.repo.delete(connection)
        self.session.commit()

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
        self, user: models.User, connection_id: UUID
    ) -> ConnectionValidationResult:
        """Re-probe a saved connection (status panel refresh)."""
        connection = resolve_connection(self.session, user, connection_id)
        try:
            adapter = build_adapter(connection)
        except InvalidInputError as exc:
            detail = exc.detail if isinstance(exc.detail, str) else "Invalid configuration."
            return ConnectionValidationResult(valid=False, message=detail)
        return adapter.validate_connection()
