"""Provider-aware validation helpers for pipeline definitions."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import RegisteredIndexRepository
from app.pipelines.definition import PipelineDefinition
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.prompt_refs import PromptRefError, resolve_prompt_references
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidationResult, PipelineValidator
from app.providers.registry import (
    get_provider,
    resolve_connection,
    resolve_embedding_width,
)
from app.schemas.enums import IndexBackend, ProviderKind
from app.services.app_config import get_app_config
from app.services.errors import ServiceError, is_external_provider_error

logger = logging.getLogger(__name__)

EmbeddingInputLimitResolver = Callable[[UUID, str], int | None]
EmbeddingDimensionResolver = Callable[[UUID, str], int | None]
IndexWidthResolver = Callable[[IndexBackend, str], int | None]
ModalityResolver = Callable[[UUID, str, ProviderKind], frozenset[str]]
AutoIngestTypesResolver = Callable[[], frozenset[str]]


@dataclass(frozen=True)
class ValidationResolvers:
    """Provider/registry lookups a caller can substitute for validation.

    One object rather than four parameters: they are the same concern —
    where the checks that need live metadata get it — and tests override
    them together to keep validation off the network.
    """

    embedding_input_limit: EmbeddingInputLimitResolver | None = None
    embedding_dimension: EmbeddingDimensionResolver | None = None
    index_width: IndexWidthResolver | None = None
    model_modalities: ModalityResolver | None = None
    auto_ingest_types: AutoIngestTypesResolver | None = None


MetadataT = TypeVar("MetadataT")


def _guarded_lookup(
    label: str,
    connection_id: UUID,
    model_name: str,
    lookup: Callable[[], MetadataT],
    unknown: MetadataT,
) -> MetadataT:
    """Run a provider metadata lookup, treating recognized failures as unknown.

    Validation must still answer when a provider is down or a connection was
    removed — the finding that depends on the value is simply not emitted.
    An internal bug still surfaces as itself. `unknown` is what "we could
    not find out" looks like for this lookup's type.
    """
    try:
        return lookup()
    except Exception as exc:
        if not isinstance(exc, ServiceError) and not is_external_provider_error(exc):
            raise
        logger.warning(
            "%s unavailable for connection=%s model=%s: %s",
            label,
            connection_id,
            model_name,
            exc,
        )
        return unknown


def _limit_resolver(
    session: Session, user: models.User, overrides: ValidationResolvers
) -> EmbeddingInputLimitResolver:
    """The embedding input limit a provider publishes for a model."""

    def resolve(connection_id: UUID, model_name: str) -> int | None:
        def lookup() -> int | None:
            if overrides.embedding_input_limit is not None:
                return overrides.embedding_input_limit(connection_id, model_name)
            connection = resolve_connection(session, user, connection_id)
            return get_provider(connection, ProviderKind.EMBEDDING).embedding_input_limit(
                model_name
            )

        return _guarded_lookup("Embedding input limit", connection_id, model_name, lookup, None)

    return resolve


def _dimension_resolver(
    session: Session, user: models.User, overrides: ValidationResolvers
) -> EmbeddingDimensionResolver:
    """The vector width a model produces — catalog first, measured second."""

    def resolve(connection_id: UUID, model_name: str) -> int | None:
        def lookup() -> int | None:
            if overrides.embedding_dimension is not None:
                return overrides.embedding_dimension(connection_id, model_name)
            connection = resolve_connection(session, user, connection_id)
            adapter = get_provider(connection, ProviderKind.EMBEDDING)
            return resolve_embedding_width(adapter, connection_id, model_name)

        return _guarded_lookup("Embedding dimension", connection_id, model_name, lookup, None)

    return resolve


def _modality_resolver(
    session: Session, user: models.User, overrides: ValidationResolvers
) -> ModalityResolver:
    """The input modalities a model's catalog publishes; empty when it publishes none."""

    def resolve(connection_id: UUID, model_name: str, kind: ProviderKind) -> frozenset[str]:
        def lookup() -> frozenset[str]:
            if overrides.model_modalities is not None:
                return overrides.model_modalities(connection_id, model_name, kind)
            connection = resolve_connection(session, user, connection_id)
            return get_provider(connection, kind).catalog_input_modalities(model_name, kind)

        return _guarded_lookup("Model modalities", connection_id, model_name, lookup, frozenset())

    return resolve


def _width_resolver(
    session: Session, user: models.User, overrides: ValidationResolvers
) -> IndexWidthResolver:
    """The width of the registered index a node names, when one answers for it.

    The registry is where an index's width lives once the index exists —
    scaffolded pipelines name an index rather than restate its shape, so the
    node's own `dimension` field is empty in the common case. An unregistered
    name is genuinely unknown (not created yet), never zero.
    """

    def resolve(backend: IndexBackend, index_name: str) -> int | None:
        if overrides.index_width is not None:
            return overrides.index_width(backend, index_name)
        row = RegisteredIndexRepository(session).find_by_identity(user.id, backend, index_name)
        return row.dimension if row is not None else None

    return resolve


def _auto_ingest_resolver(overrides: ValidationResolvers) -> AutoIngestTypesResolver:
    """The content types this deployment auto-ingests."""

    def resolve() -> frozenset[str]:
        if overrides.auto_ingest_types is not None:
            return overrides.auto_ingest_types()
        return frozenset(get_app_config().uploads.allowed_content_types)

    return resolve


def _bind(
    session: Session, user: models.User, overrides: ValidationResolvers
) -> ValidationResolvers:
    """Bind every resolver to this session and user, honouring overrides.

    Each resolver answers "unknown" rather than raising when the provider is
    down or the connection was removed: validation must still produce a
    result, minus the findings that needed the value.
    """
    return ValidationResolvers(
        embedding_input_limit=_limit_resolver(session, user, overrides),
        embedding_dimension=_dimension_resolver(session, user, overrides),
        index_width=_width_resolver(session, user, overrides),
        model_modalities=_modality_resolver(session, user, overrides),
        auto_ingest_types=_auto_ingest_resolver(overrides),
    )


def _validator(bound: ValidationResolvers) -> PipelineValidator:
    """Build the validator wired to a bound resolver set."""
    return PipelineValidator(
        default_registry(),
        embedding_input_limit=bound.embedding_input_limit,
        embedding_dimension=bound.embedding_dimension,
        index_width=bound.index_width,
        model_modalities=bound.model_modalities,
        auto_ingest_types=bound.auto_ingest_types,
    )


def validate_pipeline_definition(
    session: Session,
    user: models.User,
    definition: PipelineDefinition,
    *,
    resolvers: ValidationResolvers | None = None,
) -> PipelineValidationResult:
    """Validate structure and advisory provider limits for one user."""
    bound = _bind(session, user, resolvers or ValidationResolvers())
    try:
        definition, _ = resolve_prompt_references(session, user.id, definition)
    except PromptRefError as exc:
        result = _validator(bound).validate(definition)
        result.issues.append(
            PipelineValidationIssue(
                message=str(exc),
                severity="error",
                node_id=exc.node_id,
                field="prompt_ref",
            )
        )
        return result
    return _validator(bound).validate(definition)


def log_pipeline_validation_warnings(
    result: PipelineValidationResult,
    *,
    context: str,
) -> None:
    """Surface advisory findings without interrupting a lifecycle operation."""
    for issue in result.issues:
        if issue.severity == "warning":
            logger.warning("Pipeline validation warning during %s: %s", context, issue.message)
