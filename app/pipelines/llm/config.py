"""Declarative config contract shared by every LLM node shell.

The user defines named output fields; each field declares the JSON type the
model must produce and the write target the engine applies it to. The node
shells constrain which targets are legal (`llm.rerank` alone writes `score`,
`llm.generate` alone consumes an `items` field) — the contract itself is
shell-agnostic so the editor renders one builder for all three.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.schemas.prompts import PromptReference

#: JSON types an output field may declare.
OutputFieldType = Literal["string", "number", "boolean", "string_list"]


class MetadataTarget(BaseModel):
    """Write the field's value into `item.metadata.data[key]`."""

    kind: Literal["metadata"] = "metadata"
    key: str = Field(min_length=1)


class TextTarget(BaseModel):
    """Write the field's value into the item's text.

    `prepend`/`append` join the existing text with `separator`; `replace`
    discards it. Contextual retrieval is one `prepend` field.
    """

    kind: Literal["text"] = "text"
    mode: Literal["replace", "prepend", "append"] = "replace"
    separator: str = "\n\n"


class ScoreTarget(BaseModel):
    """Write the field's numeric value as the item's score (`llm.rerank`)."""

    kind: Literal["score"] = "score"


class ItemsTarget(BaseModel):
    """Emit one new item per string in the field's list (`llm.generate`)."""

    kind: Literal["items"] = "items"


OutputTarget = Annotated[
    MetadataTarget | TextTarget | ScoreTarget | ItemsTarget,
    Field(discriminator="kind"),
]


class OutputFieldSpec(BaseModel):
    """One named field of the structured output the model must return."""

    name: str = Field(min_length=1, pattern=r"^[a-zA-Z_][a-zA-Z0-9_]*$")
    type: OutputFieldType = "string"
    description: str = ""
    target: OutputTarget


class LlmNodeConfig(BaseModel):
    """Config fields every LLM node shell shares.

    `connection_id`/`model_name` are the structured model-identity pair
    (`static_only`, matching the reranker node). `prompt` and
    `system_prompt` are placeholder templates rendered per call by
    `app/pipelines/llm/prompts.py` — plain substitution, not expressions.
    """

    connection_id: UUID | None = Field(
        default=None,
        description="Provider connection that serves the chat model.",
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    model_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)
    #: Library reference; resolution fills `system_prompt`/`prompt` from the
    #: referenced version before validation and execution. Inline text with
    #: no reference remains valid for historical pipeline versions.
    prompt_ref: PromptReference | None = None
    system_prompt: str = ""
    prompt: str = ""
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    output_fields: list[OutputFieldSpec] = Field(default_factory=list)
