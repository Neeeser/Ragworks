"""Every shipped create-pipeline template builds a graph the validator accepts.

The wizard's templates are built in the frontend and exported to
`tests/assets/pipeline_templates.json` (`npm run export:templates`); a template
naming a port the node registry does not declare is otherwise only discovered
by a user clicking Create.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.pipelines.definition import PipelineDefinition
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidator

TEMPLATE_ASSET = Path("tests/assets/pipeline_templates.json")


def _templates() -> list[tuple[str, PipelineDefinition]]:
    """The exported templates, as (id, definition) pairs."""
    payload = json.loads(TEMPLATE_ASSET.read_text())
    return [
        (entry["id"], PipelineDefinition.model_validate(entry["definition"])) for entry in payload
    ]


@pytest.mark.parametrize(("template_id", "definition"), _templates())
def test_shipped_template_passes_validation(
    template_id: str, definition: PipelineDefinition
) -> None:
    """A template the wizard offers must produce a creatable pipeline."""
    result = PipelineValidator(default_registry()).validate(definition)

    errors = [issue.message for issue in result.issues if issue.severity == "error"]
    assert result.errors == [], f"{template_id}: {result.errors}"
    assert errors == [], f"{template_id}: {errors}"


def test_every_offered_template_is_exported() -> None:
    """The asset covers the whole catalog, so no template escapes the guard."""
    exported = {template_id for template_id, _ in _templates()}
    assert exported == {"semantic-keyword", "reranked", "count", "facet", "blank"}
