"""Provider-aware validation helpers for pipeline definitions."""

from __future__ import annotations

import logging
from collections.abc import Callable
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
from app.services.errors import ServiceError, is_external_provider_error

logger = logging.getLogger(__name__)

EmbeddingInputLimitResolver = Callable[[UUID, str], int | None]
EmbeddingDimensionResolver = Callable[[UUID, str], int | None]
IndexWidthResolver = Callable[[IndexBackend, str], int | None]


def _guarded_lookup(
    label: str,
    connection_id: UUID,
    model_name: str,
    lookup: Callable[[], int | None],
) -> int | None:
    """Run a provider metadata lookup, treating recognized failures as unknown.

    Validation must still answer when a provider is down or a connection was
    removed — the finding that depends on the value is simply not emitted.
    An internal bug still surfaces as itself.
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
        return None


def validate_pipeline_definition(
    session: Session,
    user: models.User,
    definition: PipelineDefinition,
    *,
    embedding_input_limit: EmbeddingInputLimitResolver | None = None,
    embedding_dimension: EmbeddingDimensionResolver | None = None,
    index_width: IndexWidthResolver | None = None,
) -> PipelineValidationResult:
    """Validate structure and advisory provider limits for one user."""

    def resolve_limit(connection_id: UUID, model_name: str) -> int | None:
        def lookup() -> int | None:
            if embedding_input_limit is not None:
                return embedding_input_limit(connection_id, model_name)
            connection = resolve_connection(session, user, connection_id)
            adapter = get_provider(connection, ProviderKind.EMBEDDING)
            return adapter.embedding_input_limit(model_name)

        return _guarded_lookup("Embedding input limit", connection_id, model_name, lookup)

    def resolve_dimension(connection_id: UUID, model_name: str) -> int | None:
        def lookup() -> int | None:
            if embedding_dimension is not None:
                return embedding_dimension(connection_id, model_name)
            connection = resolve_connection(session, user, connection_id)
            adapter = get_provider(connection, ProviderKind.EMBEDDING)
            return resolve_embedding_width(adapter, connection_id, model_name)

        return _guarded_lookup("Embedding dimension", connection_id, model_name, lookup)

    def resolve_index_width(backend: IndexBackend, index_name: str) -> int | None:
        """Return the width of the registered index a node names, when known.

        The registry is where an index's width lives once the index exists —
        scaffolded pipelines name an index rather than restate its shape, so
        the node's own `dimension` field is empty in the common case. An
        unregistered name is genuinely unknown (not created yet), never zero.
        """
        if index_width is not None:
            return index_width(backend, index_name)
        row = RegisteredIndexRepository(session).find_by_identity(user.id, backend, index_name)
        return row.dimension if row is not None else None

    try:
        definition, _ = resolve_prompt_references(session, user.id, definition)
    except PromptRefError as exc:
        result = PipelineValidator(
            default_registry(),
            embedding_input_limit=resolve_limit,
            embedding_dimension=resolve_dimension,
            index_width=resolve_index_width,
        ).validate(definition)
        result.issues.append(
            PipelineValidationIssue(
                message=str(exc),
                severity="error",
                node_id=exc.node_id,
                field="prompt_ref",
            )
        )
        return result
    return PipelineValidator(
        default_registry(),
        embedding_input_limit=resolve_limit,
        embedding_dimension=resolve_dimension,
        index_width=resolve_index_width,
    ).validate(definition)


def log_pipeline_validation_warnings(
    result: PipelineValidationResult,
    *,
    context: str,
) -> None:
    """Surface advisory findings without interrupting a lifecycle operation."""
    for issue in result.issues:
        if issue.severity == "warning":
            logger.warning("Pipeline validation warning during %s: %s", context, issue.message)
