"""Which auto-ingestable content types a pipeline's parse nodes claim.

A deployment's auto-ingest list (`uploads.allowed_content_types`) says
which uploads start a pipeline run on their own. A type nothing in the
pipeline parses reaches the graph and produces nothing, so the run
succeeds having indexed an empty document — the finding names those types
while the pipeline is still being edited.

Advisory, never save-blocking: a pipeline may legitimately be built for a
subset of what the deployment accepts.
"""

from __future__ import annotations

from collections.abc import Callable

from app.pipelines.definition import PipelineDefinition
from app.pipelines.node import ContentTypeClaim, PipelineValidationIssue
from app.pipelines.ports import Facet, PortKind
from app.pipelines.registry import NodeRegistry

#: The deployment's auto-ingest content types. Injected like the other
#: validation resolvers — the engine does not import services.
AutoIngestTypesResolver = Callable[[], frozenset[str]]

COVERAGE_CODE = "coverage.content_types"


def content_coverage_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    auto_ingest_types: AutoIngestTypesResolver | None,
) -> list[PipelineValidationIssue]:
    """Return one warning naming auto-ingestable types nothing here parses."""
    if auto_ingest_types is None or not _takes_uploads(definition, registry):
        return []
    allowed = auto_ingest_types()
    if not allowed:
        return []
    claim = _claimed(definition, registry)
    if claim.any_type:
        return []
    uncovered = sorted(allowed - claim.types)
    if not uncovered:
        return []
    return [
        PipelineValidationIssue(
            message=(
                "No parse node in this pipeline handles "
                f"{', '.join(uncovered)} — uploads of those types are "
                "auto-ingested and would produce nothing."
            ),
            severity="warning",
            code=COVERAGE_CODE,
        )
    ]


def _takes_uploads(definition: PipelineDefinition, registry: NodeRegistry) -> bool:
    """True when some node in this graph emits the uploaded file as items."""
    return any(
        port.data_type == PortKind.ITEMS and Facet.FILE in port.adds
        for node in definition.nodes
        if (spec := registry.get_spec(node.type)) is not None
        for port in spec.output_ports
    )


def _claimed(definition: PipelineDefinition, registry: NodeRegistry) -> ContentTypeClaim:
    """Union what every parse node reached by an edge claims to parse.

    A parse node with nothing wired into it never sees a file, so its
    formats are not covered by this pipeline however the node is
    configured.
    """
    wired = {edge.target for edge in definition.edges}
    types: set[str] = set()
    any_type = False
    for node in definition.nodes:
        node_cls = registry.get_node_class(node.type)
        if node_cls is None or node.id not in wired:
            continue
        claim = node_cls.content_type_claim(node.config or {})
        if claim is None:
            continue
        types |= claim.types
        any_type = any_type or claim.any_type
    return ContentTypeClaim(types=frozenset(types), any_type=any_type)
