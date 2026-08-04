"""Duplicate tool-name detection across a collection's tool bindings.

Two tool bindings sharing a base name project the *same* exposed tool to the
model -- `tool_exposed_name` appends only the collection's own slug, which is
identical for every binding of one collection, so the model has no way to
tell the two apart. Bind-time checks
(`CollectionToolService._reject_duplicate_tool_name`,
`app.services.pipeline_tool_names.reject_tool_name_collision`) refuse to
*create* a new collision, but a collection bound before those checks existed
can still hold one; this rule surfaces it rather than silently renaming a
user's tool.
"""

from __future__ import annotations

from app.schemas.diagnostics import (
    CollectionDiagnostic,
    DiagnosticAction,
    DiagnosticCategory,
    DiagnosticResource,
)
from app.services.diagnostics.context import DiagnosticContext
from app.services.diagnostics.rules.base import build_diagnostic, pipeline_builder_route
from app.services.tool_naming import tool_base_name


class DuplicateToolNameRule:
    """Two of a collection's tool bindings resolve to the same tool name (error)."""

    code = "duplicate_tool_name"
    category: DiagnosticCategory = "pipeline_compatibility"

    def evaluate(self, ctx: DiagnosticContext) -> list[CollectionDiagnostic]:
        """Flag every base name shared by two or more of the collection's tools."""
        by_base: dict[str, list[str]] = {}
        names: dict[str, str] = {}
        for resolved in ctx.tool_bindings:
            base = tool_base_name(resolved.interface)
            pipeline_id = str(resolved.pipeline.id)
            by_base.setdefault(base, []).append(pipeline_id)
            names[pipeline_id] = resolved.pipeline.name
        return [
            self._finding(base, pipeline_ids, names)
            for base, pipeline_ids in by_base.items()
            if len(pipeline_ids) > 1
        ]

    def _finding(
        self,
        base: str,
        pipeline_ids: list[str],
        names: dict[str, str],
    ) -> CollectionDiagnostic:
        """Build one finding naming every pipeline that shares `base`."""
        labels = ", ".join(f"'{names[pipeline_id]}'" for pipeline_id in pipeline_ids)
        return build_diagnostic(
            code=self.code,
            severity="error",
            confidence="confirmed",
            category=self.category,
            title="Two tool bindings expose the same tool name",
            summary=(
                f"{labels} all expose the tool name '{base}' in this collection, so the "
                "model has no way to tell them apart. Set a unique 'tool_name' on the "
                "query-input node of each but one."
            ),
            resources=[
                DiagnosticResource(
                    kind="pipeline",
                    id=pipeline_id,
                    name=names[pipeline_id],
                    pipeline_side="retrieval",
                )
                for pipeline_id in pipeline_ids
            ],
            action=DiagnosticAction(
                label="Edit retrieval pipeline",
                route=pipeline_builder_route("retrieval"),
            ),
        )
