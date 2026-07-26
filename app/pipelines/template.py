"""Template helpers for pipeline configuration values."""

from __future__ import annotations

from pydantic import Field

from app.db import models
from app.pipelines.variables import STATIC_ONLY_EXTRA

NAMESPACE_COLLECTION_PREFIX = "col-"
DEFAULT_NAMESPACE_TEMPLATE = f"{NAMESPACE_COLLECTION_PREFIX}{{collection_id}}"

def namespace_field() -> str:
    """The `namespace` config field every store-bound node declares.

    One factory rather than a repeated `Field(...)`: the default, the editor
    description, and the static-only marker are one decision about what a
    namespace is, and they must not drift between the nodes that carry it.
    """
    return Field(
        default=DEFAULT_NAMESPACE_TEMPLATE,
        description=(
            "Partition within the index. Defaults to this collection; a run can "
            "only read and write namespaces of collections you own."
        ),
        json_schema_extra=STATIC_ONLY_EXTRA,
    )


def resolve_collection_template(
    value: str | None,
    collection: models.Collection,
) -> str | None:
    """Resolve collection placeholders inside a template string."""
    if value is None:
        return None
    rendered = value
    rendered = rendered.replace("{collection_id}", str(collection.id))
    rendered = rendered.replace("{collection_name}", collection.name or "")
    rendered = rendered.replace("{user_id}", str(collection.user_id))
    return rendered
