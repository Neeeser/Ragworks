# pylint: disable=duplicate-code
"""Pipeline services for managing definitions, versions, and defaults."""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.db.repositories import (
    CollectionPipelineBindingRepository,
    CollectionRepository,
    PipelineRepository,
    PipelineVersionRepository,
    UserRepository,
)
from app.pipelines.definition import PipelineDefinition
from app.pipelines.diff import DefinitionChange, diff_definitions, material_changes
from app.pipelines.interface import PipelineInterface, derive_interface
from app.pipelines.nodes.chunking import BaseChunkerNode, FixedChunkerConfig
from app.pipelines.registry import default_registry
from app.pipelines.resolution import resolve_static_definition
from app.pipelines.validation import PipelineValidationResult
from app.schemas.enums import PipelineKind
from app.services.errors import InvalidInputError, NotFoundError
from app.services.huggingface_tokenizers import HuggingFaceTokenizerService
from app.services.pipeline_defaults import (
    DEFAULT_INGEST_SLUG as DEFAULT_INGEST_SLUG,
)
from app.services.pipeline_defaults import (
    DEFAULT_SEARCH_SLUG as DEFAULT_SEARCH_SLUG,
)
from app.services.pipeline_defaults import (
    DefaultPipelines,
    ensure_collection_bindings,
    ensure_default_pipelines,
)
from app.services.pipeline_defaults import (
    backfill_default_pipelines as backfill_default_pipelines,
)
from app.services.pipeline_upgrades import (
    upgrade_stored_pipeline_definitions as upgrade_stored_pipeline_definitions,
)
from app.services.pipeline_validation import (
    EmbeddingInputLimitResolver,
    validate_pipeline_definition,
)


def derived_kind(interface: PipelineInterface) -> PipelineKind | None:
    """Map a derived interface onto the wire's UI-grouping kind.

    Document-accepting graphs group as ingestion; callable graphs as
    retrieval. A graph that is neither has no kind — it shows ungrouped.
    """
    if interface.accepts_document:
        return PipelineKind.INGESTION
    if interface.callable:
        return PipelineKind.RETRIEVAL
    return None


class PipelineService:
    """Service for pipeline CRUD and version management."""

    def __init__(
        self,
        session: Session,
        *,
        embedding_input_limit: EmbeddingInputLimitResolver | None = None,
    ) -> None:
        """Initialize with an optional provider-limit override for focused tests."""
        self.session = session
        self._pipelines = PipelineRepository(session)
        self._versions = PipelineVersionRepository(session)
        self._collections = CollectionRepository(session)
        self._bindings = CollectionPipelineBindingRepository(session)
        self._users = UserRepository(session)
        self._embedding_input_limit = embedding_input_limit

    def validate_definition(
        self,
        user: models.User,
        definition: PipelineDefinition,
    ) -> PipelineValidationResult:
        """Validate a definition using its selected provider connections."""
        return validate_pipeline_definition(
            self.session,
            user,
            definition,
            embedding_input_limit=self._embedding_input_limit,
        )

    def _validate_before_persisting(
        self,
        user: models.User,
        definition: PipelineDefinition,
    ) -> None:
        """Reject invalid definitions with field-addressable issue metadata."""
        result = self.validate_definition(user, definition)
        if result.valid:
            self._ensure_huggingface_tokenizers(user, definition)
            return
        raise InvalidInputError(
            {
                "errors": result.errors,
                "issues": [
                    issue.model_dump(exclude_none=True)
                    for issue in result.issues
                    if issue.severity == "error"
                ],
            }
        )

    def _ensure_huggingface_tokenizers(
        self,
        user: models.User,
        definition: PipelineDefinition,
    ) -> None:
        """Resolve HF tokenizer caches before a definition is persisted."""
        service = HuggingFaceTokenizerService(self.session, get_settings().storage_path)
        for node in resolve_static_definition(definition).nodes:
            node_cls = default_registry().get_node_class(node.type)
            if node_cls is None or not issubclass(node_cls, BaseChunkerNode):
                continue
            config = FixedChunkerConfig.model_validate(node.config or {})
            if config.tokenizer == "huggingface" and config.hf_model_id:
                service.ensure_available(user, config.hf_model_id)

    def list_pipelines(
        self,
        user_id: UUID,
        *,
        kind: PipelineKind | None = None,
    ) -> list[models.Pipeline]:
        """Return pipelines for the given user, optionally filtered by derived kind.

        A shape-less graph (neither document-accepting nor callable — blank
        or mid-edit) matches every kind filter: the editor is kind-paged, and
        a pipeline no filter matches would be unreachable from it.
        """
        pipelines = self._pipelines.list_for_user(user_id)
        if kind is None:
            return pipelines
        return [
            pipeline
            for pipeline in pipelines
            if derived_kind(self.interface_for(pipeline)) in (kind, None)
        ]

    def get_pipeline(self, pipeline_id: UUID, user_id: UUID) -> models.Pipeline | None:
        """Return a pipeline for a user."""
        return self._pipelines.get(pipeline_id, user_id=user_id)

    def get_current_version(self, pipeline: models.Pipeline) -> models.PipelineVersion:
        """Return the current version for a pipeline."""
        version = self._versions.get_by_version(pipeline.id, pipeline.current_version)
        if not version:
            raise ValueError("Pipeline has no current version.")
        return version

    def get_definition(self, pipeline: models.Pipeline) -> PipelineDefinition:
        """Return the current definition for a pipeline."""
        version = self.get_current_version(pipeline)
        return PipelineDefinition.model_validate(version.definition)

    def interface_for(self, pipeline: models.Pipeline) -> PipelineInterface:
        """Return the current version's derived interface."""
        return self.interface_for_version(self.get_current_version(pipeline))

    @staticmethod
    def interface_for_version(version: models.PipelineVersion) -> PipelineInterface:
        """Return a version's interface: the materialized copy, or re-derived.

        Versions saved before the column existed carry NULL; deriving in
        memory (never writing — reads must not mutate) keeps them serving.
        """
        if version.interface is not None:
            return PipelineInterface.model_validate(version.interface)
        return derive_interface(PipelineDefinition.model_validate(version.definition))

    def create_pipeline(  # pylint: disable=too-many-arguments
        self,
        *,
        user: models.User,
        name: str,
        definition: PipelineDefinition,
        description: str | None = None,
        change_summary: str | None = None,
        template_slug: str | None = None,
    ) -> models.Pipeline:
        """Create a pipeline and its first version (interface materialized)."""
        self._validate_before_persisting(user, definition)
        pipeline = models.Pipeline(
            user_id=user.id,
            name=name,
            description=description,
            current_version=1,
            template_slug=template_slug,
        )
        self._pipelines.add(pipeline)
        version = models.PipelineVersion(
            pipeline_id=pipeline.id,
            version=1,
            definition=definition.model_dump(mode="json"),
            interface=derive_interface(definition).model_dump(mode="json"),
            change_summary=change_summary,
            created_by=user.id,
        )
        self._versions.add(version)
        return pipeline

    def update_pipeline(  # pylint: disable=too-many-arguments
        self,
        *,
        pipeline: models.Pipeline,
        definition: PipelineDefinition | None = None,
        name: str | None = None,
        description: str | None = None,
        change_summary: str | None = None,
        actor_id: UUID | None = None,
    ) -> models.Pipeline:
        """Update pipeline metadata and optionally create a new version.

        A definition identical to the current version is rejected (saving
        should never mint an empty revision), and a definition whose only
        difference is layout (node positions) updates the current version in
        place instead of creating a new one -- dragging nodes around is not a
        revision of what the pipeline does.
        """
        metadata_changed = name is not None or description is not None
        if definition is not None:
            owner = self._users.get(pipeline.user_id)
            if owner is None:
                raise NotFoundError("Pipeline owner does not exist.")
            self._validate_before_persisting(owner, definition)
        if name is not None:
            pipeline.name = name
        if description is not None:
            pipeline.description = description
        if definition is not None:
            current_row = self.get_current_version(pipeline)
            current = PipelineDefinition.model_validate(current_row.definition)
            changes = diff_definitions(current, definition)
            if not changes and not metadata_changed:
                raise InvalidInputError(
                    "No changes to save — the pipeline already matches this definition."
                )
            if material_changes(changes):
                next_version = pipeline.current_version + 1
                version = models.PipelineVersion(
                    pipeline_id=pipeline.id,
                    version=next_version,
                    definition=definition.model_dump(mode="json"),
                    interface=derive_interface(definition).model_dump(mode="json"),
                    change_summary=change_summary,
                    created_by=actor_id,
                )
                self._versions.add(version)
                pipeline.current_version = next_version
            elif changes:
                current_row.definition = definition.model_dump(mode="json")
                current_row.interface = derive_interface(definition).model_dump(mode="json")
                self.session.add(current_row)
        self.session.add(pipeline)
        return pipeline

    def list_versions(self, pipeline: models.Pipeline) -> list[models.PipelineVersion]:
        """List versions for a pipeline."""
        return self._versions.list_for_pipeline(pipeline.id)

    def list_versions_with_changes(
        self,
        pipeline: models.Pipeline,
    ) -> list[tuple[models.PipelineVersion, list[DefinitionChange]]]:
        """List versions newest-first, each with its diff against the prior version."""
        versions = self._versions.list_for_pipeline(pipeline.id)
        by_number = {version.version: version for version in versions}
        result: list[tuple[models.PipelineVersion, list[DefinitionChange]]] = []
        for version in versions:
            previous = by_number.get(version.version - 1)
            if previous is None:
                changes = [DefinitionChange(kind="created", summary="Initial version")]
            else:
                changes = diff_definitions(
                    PipelineDefinition.model_validate(previous.definition),
                    PipelineDefinition.model_validate(version.definition),
                )
            result.append((version, changes))
        return result

    def pipeline_in_use(self, pipeline_id: UUID) -> bool:
        """Return True if any collection binds the pipeline."""
        return self._collections.references_pipeline(pipeline_id)

    def delete_pipeline(self, pipeline: models.Pipeline) -> None:
        """Delete a pipeline and its versions."""
        self._versions.delete_for_pipeline(pipeline.id)
        self.session.delete(pipeline)
        self.session.flush()

    def activate_version(self, pipeline: models.Pipeline, version: int) -> models.Pipeline:
        """Set the pipeline's active version."""
        target = self._versions.get_by_version(pipeline.id, version)
        if not target:
            raise NotFoundError("Requested pipeline version does not exist.")
        pipeline.current_version = version
        self.session.add(pipeline)
        return pipeline

    def get_by_template_slug(
        self, user_id: UUID, template_slug: str
    ) -> models.Pipeline | None:
        """Return the user's pipeline scaffolded for a template slug."""
        return self._pipelines.get_by_template_slug(user_id, template_slug)

    def ensure_default_pipelines(self, user: models.User) -> DefaultPipelines:
        """Ensure the user's default pipelines exist (see pipeline_defaults)."""
        return ensure_default_pipelines(self, user)

    def ensure_collection_bindings(
        self,
        collection: models.Collection,
        defaults: DefaultPipelines,
    ) -> models.Collection:
        """Bind default pipelines onto an unbound collection (see pipeline_defaults)."""
        return ensure_collection_bindings(self.session, collection, defaults)
