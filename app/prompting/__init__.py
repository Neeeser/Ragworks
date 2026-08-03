"""The unified prompt-template engine.

One grammar for every prompt in the app: strict double-brace
`{{variable}}` placeholders validated against a per-context variable
catalog. Sits below both `app/pipelines` and `app/services` so the LLM
nodes and the chat prompt service render through the same engine.
"""

from app.prompting.catalogs import (
    VariableCatalog,
    VariableNamespace,
    catalog_for,
)
from app.prompting.grammar import (
    PromptTemplateError,
    referenced_variables,
    render_template,
)

__all__ = [
    "PromptTemplateError",
    "VariableCatalog",
    "VariableNamespace",
    "catalog_for",
    "referenced_variables",
    "render_template",
]
