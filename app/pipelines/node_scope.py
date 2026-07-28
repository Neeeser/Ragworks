"""Resolution order for a node's own config fields (`self.<field>`).

A config field may read a sibling on the same node, so the fields of one node
can no longer resolve independently: `chunk_overlap = self.chunk_size * 0.2`
has to see `chunk_size` already reduced to a literal.

Order comes from the dependency graph, never from the config dict's key order.
Key order is an artifact of however the definition was serialized — a
definition round-tripped through a different JSON writer would otherwise
resolve to different values.
"""

from __future__ import annotations

from collections.abc import Mapping

from app.pipelines.expressions import ExpressionError, parse, self_references
from app.pipelines.variables import expression_source


class ConfigCycleError(Exception):
    """A node's config fields reference each other in a cycle."""

    def __init__(self, fields: list[str]) -> None:
        """Record the fields that form the cycle, sorted for a stable message."""
        self.fields = fields
        super().__init__(f"Config fields reference each other in a cycle: {', '.join(fields)}")


def self_dependencies(config: Mapping[str, object]) -> dict[str, frozenset[str]]:
    """Map each config key to the sibling fields its expression reads.

    Unparseable sources contribute no dependencies: syntax errors are reported
    by validation with a position, and failing here would turn a typo into an
    ordering crash.
    """
    dependencies: dict[str, frozenset[str]] = {}
    for key, value in config.items():
        source = expression_source(value)
        if source is None:
            dependencies[key] = frozenset()
            continue
        try:
            dependencies[key] = self_references(parse(source))
        except ExpressionError:
            dependencies[key] = frozenset()
    return dependencies


def resolution_order(dependencies: Mapping[str, frozenset[str]]) -> list[str]:
    """Return config keys in dependency order, dependencies first.

    Raises `ConfigCycleError` when fields reference each other in a loop, which
    has no valid order and would otherwise recurse forever.
    """
    ordered: list[str] = []
    done: set[str] = set()
    visiting: list[str] = []
    in_progress: set[str] = set()

    def visit(key: str) -> None:
        if key in done:
            return
        if key in in_progress:
            start = visiting.index(key)
            raise ConfigCycleError(sorted(set(visiting[start:])))
        in_progress.add(key)
        visiting.append(key)
        for dependency in sorted(dependencies.get(key, frozenset())):
            # A reference to a field the node does not declare is a validation
            # issue, not an ordering one; skip it and let validation report it.
            if dependency in dependencies:
                visit(dependency)
        visiting.pop()
        in_progress.discard(key)
        done.add(key)
        ordered.append(key)

    for key in sorted(dependencies):
        visit(key)
    return ordered
