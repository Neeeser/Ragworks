"""Binding management for a collection's tools and ingest pipeline.

Owns the invariants the schema deliberately leaves to the service layer:
at most one ingest binding per collection, exactly one primary among a
collection's tool bindings, and bind-time fitness (an ingest binding needs a
document-accepting graph, a tool binding a callable one — both read off the
pipeline's derived interface, never a stored flag).
"""

from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository
from app.services.binding_variables import resolve_binding_values
from app.services.errors import InvalidInputError, NotFoundError
from app.services.pipelines import PipelineService


class CollectionToolService:
    """Manage a collection's pipeline bindings (ingest + tools)."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.bindings = CollectionPipelineBindingRepository(session)
        self.pipelines = PipelineService(session)

    def list_tools(
        self, collection: models.Collection
    ) -> list[models.CollectionPipelineBinding]:
        """List the collection's tool bindings in position order."""
        return self.bindings.list_for_collection(
            collection.id, role=models.BindingRole.TOOL
        )

    def list_enabled_tools(
        self, collection: models.Collection
    ) -> list[models.CollectionPipelineBinding]:
        """List the collection's enabled tool bindings in position order."""
        return [binding for binding in self.list_tools(collection) if binding.enabled]

    def get_ingest_binding(
        self, collection: models.Collection
    ) -> models.CollectionPipelineBinding | None:
        """Return the collection's ingest binding, if bound."""
        ingest = self.bindings.list_for_collection(
            collection.id, role=models.BindingRole.INGEST
        )
        return ingest[0] if ingest else None

    def add_tool(
        self,
        user: models.User,
        collection: models.Collection,
        pipeline_id: UUID,
        variable_values: Mapping[str, object] | None = None,
    ) -> models.CollectionPipelineBinding:
        """Bind a pipeline as a tool; the first tool becomes primary."""
        pipeline = self._require_callable_pipeline(user, pipeline_id)
        existing = self.list_tools(collection)
        if any(binding.pipeline_id == pipeline.id for binding in existing):
            raise InvalidInputError("This pipeline is already bound as a tool.")
        binding = models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.TOOL,
            is_primary=not existing,
            position=max((b.position for b in existing), default=-1) + 1,
            variable_values=resolve_binding_values(
                self.session,
                user,
                collection,
                self.pipelines.get_definition(pipeline),
                variable_values,
            ),
        )
        self.bindings.add(binding)
        return binding

    def set_variable_values(
        self,
        user: models.User,
        collection: models.Collection,
        binding_id: UUID,
        variable_values: Mapping[str, object],
    ) -> models.CollectionPipelineBinding:
        """Repoint one binding's variables (its index, typically).

        Reassigns the whole dict rather than mutating in place: the JSON
        column is not `MutableDict`-wrapped, so an in-place update is never
        written while the in-memory object still reads correct.
        """
        binding = self._require_binding(collection, binding_id)
        pipeline = self.pipelines.get_pipeline(binding.pipeline_id, user.id)
        if pipeline is None:
            raise NotFoundError("Pipeline not found.")
        binding.variable_values = resolve_binding_values(
            self.session,
            user,
            collection,
            self.pipelines.get_definition(pipeline),
            variable_values,
            exclude_binding_ids=frozenset({binding.id}),
        )
        self.session.add(binding)
        return binding

    def remove_tool(
        self,
        user: models.User,
        collection: models.Collection,
        binding_id: UUID,
    ) -> None:
        """Remove a tool binding; a removed primary promotes the next tool."""
        del user  # ownership of the collection is checked at the route
        binding = self._require_tool_binding(collection, binding_id)
        was_primary = binding.is_primary
        self.bindings.delete(binding)
        self.session.flush()
        if was_primary:
            remaining = self.list_tools(collection)
            if remaining:
                remaining[0].is_primary = True
                self.session.add(remaining[0])

    def set_primary(
        self,
        user: models.User,
        collection: models.Collection,
        binding_id: UUID,
    ) -> models.CollectionPipelineBinding:
        """Designate one tool binding as the collection's primary search tool."""
        del user
        target = self._require_tool_binding(collection, binding_id)
        for binding in self.list_tools(collection):
            is_target = binding.id == target.id
            if binding.is_primary != is_target:
                binding.is_primary = is_target
                self.session.add(binding)
        return target

    def set_enabled(
        self,
        user: models.User,
        collection: models.Collection,
        binding_id: UUID,
        *,
        enabled: bool,
    ) -> models.CollectionPipelineBinding:
        """Enable or disable a tool binding's exposure (chat/MCP)."""
        del user
        binding = self._require_tool_binding(collection, binding_id)
        binding.enabled = enabled
        self.session.add(binding)
        return binding

    def set_ingest_pipeline(
        self,
        user: models.User,
        collection: models.Collection,
        pipeline_id: UUID,
        variable_values: Mapping[str, object] | None = None,
    ) -> models.CollectionPipelineBinding:
        """Bind (or rebind) the collection's single ingest pipeline."""
        pipeline = self.pipelines.get_pipeline(pipeline_id, user.id)
        if not pipeline:
            raise NotFoundError("Pipeline not found.")
        interface = self.pipelines.interface_for(pipeline)
        if not interface.accepts_document:
            raise InvalidInputError(
                f"Pipeline '{pipeline.name}' does not accept documents and cannot ingest."
            )
        existing = self.get_ingest_binding(collection)
        values = resolve_binding_values(
            self.session,
            user,
            collection,
            self.pipelines.get_definition(pipeline),
            variable_values,
            exclude_binding_ids=(
                frozenset({existing.id}) if existing is not None else frozenset()
            ),
        )
        if existing is not None:
            existing.pipeline_id = pipeline.id
            existing.variable_values = values
            self.session.add(existing)
            return existing
        binding = models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.INGEST,
            variable_values=values,
        )
        self.bindings.add(binding)
        return binding

    def _require_callable_pipeline(
        self, user: models.User, pipeline_id: UUID
    ) -> models.Pipeline:
        """Return a user-owned callable pipeline or raise."""
        pipeline = self.pipelines.get_pipeline(pipeline_id, user.id)
        if not pipeline:
            raise NotFoundError("Pipeline not found.")
        interface = self.pipelines.interface_for(pipeline)
        if not interface.callable:
            raise InvalidInputError(
                f"Pipeline '{pipeline.name}' has no query input and cannot serve as a tool."
            )
        return pipeline

    def _require_binding(
        self, collection: models.Collection, binding_id: UUID
    ) -> models.CollectionPipelineBinding:
        """Return one of the collection's bindings in any role, or raise."""
        binding = self.bindings.get_for_collection(collection.id, binding_id)
        if binding is None:
            raise NotFoundError("Binding not found.")
        return binding

    def _require_tool_binding(
        self, collection: models.Collection, binding_id: UUID
    ) -> models.CollectionPipelineBinding:
        """Return one of the collection's tool bindings or raise NotFound."""
        binding = self.bindings.get_for_collection(collection.id, binding_id)
        if binding is None or binding.role != models.BindingRole.TOOL:
            raise NotFoundError("Tool binding not found.")
        return binding
