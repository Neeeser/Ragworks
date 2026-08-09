"""What content types a pipeline's parse nodes claim to read.

Parse nodes declare their registries statically, so the set of types a graph
can read is answerable without running it. Upload eligibility reads this to
record a file no parse node claims as unsupported instead of spending a run
to discover it.
"""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition
from app.pipelines.node import ContentTypeClaim
from app.pipelines.registry import NodeRegistry


def claimed_content_types(
    definition: PipelineDefinition, registry: NodeRegistry
) -> ContentTypeClaim:
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
