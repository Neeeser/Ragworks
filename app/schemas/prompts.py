"""Schema models for the prompt library and template rendering."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.enums import PromptContext, PromptSource

#: A consumer's version choice: a concrete pin or the Docker-style tag.
PromptVersionSelector = int | Literal["latest"]


class PromptVariable(BaseModel):
    """Template variable used in prompts."""

    name: str
    description: str
    example: str | None = None


class PromptNamespaceRead(BaseModel):
    """An open variable namespace (`metadata.*`) a context exposes."""

    prefix: str
    description: str
    example_name: str = ""


class PromptCatalogRead(BaseModel):
    """The variable catalog one prompt context exposes."""

    context: PromptContext
    variables: list[PromptVariable]
    namespaces: list[PromptNamespaceRead]


class PromptReference(BaseModel):
    """How a consumer names a prompt: entity id plus version pin or latest."""

    prompt_id: UUID
    version: PromptVersionSelector = "latest"


class PromptVersionRead(BaseModel):
    """One immutable revision of a prompt."""

    id: UUID
    prompt_id: UUID
    version: int
    body: str
    system_body: str | None = None
    label: str | None = None
    output_fields: list[dict[str, object]] | None = None
    created_at: datetime


class PromptUsageRead(BaseModel):
    """One consumer that references a prompt."""

    kind: Literal["chat_base", "collection_tool", "pipeline_node"]
    name: str
    id: str
    version: PromptVersionSelector = "latest"


class PromptRead(BaseModel):
    """Prompt library entry returned to clients."""

    id: UUID
    name: str
    description: str | None = None
    context: PromptContext
    source: PromptSource
    shipped_key: str | None = None
    current_version: int
    created_at: datetime
    updated_at: datetime | None = None


class PromptDetailRead(PromptRead):
    """A prompt with its current version body and usage listing."""

    body: str
    system_body: str | None = None
    output_fields: list[dict[str, object]] | None = None
    used_by: list[PromptUsageRead]


class PromptCreate(BaseModel):
    """Payload for creating a prompt (v1 is the supplied body)."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    context: PromptContext
    body: str = Field(min_length=1)
    system_body: str | None = None
    output_fields: list[dict[str, object]] | None = None


class PromptUpdate(BaseModel):
    """Rename/redescribe a prompt; template changes go through versions."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class PromptVersionCreate(BaseModel):
    """Payload for saving a new version of a prompt."""

    body: str = Field(min_length=1)
    system_body: str | None = None
    label: str | None = Field(default=None, max_length=120)
    output_fields: list[dict[str, object]] | None = None


class PromptForkCreate(BaseModel):
    """Payload for forking a prompt into a new entity.

    `body`/`system_body`/`output_fields` override the source version when
    supplied — the fork-and-edit path, where a read-only shipped prompt's
    draft becomes v1 of the fork.
    """

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    context: PromptContext | None = None
    version: PromptVersionSelector = "latest"
    body: str | None = None
    system_body: str | None = None
    output_fields: list[dict[str, object]] | None = None


class PromptRenderRequest(BaseModel):
    """Render a template against example (or caller-supplied) context."""

    body: str
    system_body: str | None = None
    context: PromptContext
    values: dict[str, str] = Field(default_factory=dict)


class PromptRenderRead(BaseModel):
    """A rendered template plus the strict-validation findings."""

    rendered: str
    rendered_system: str | None = None
    unknown_variables: list[str]
    values: dict[str, str]


class PromptTestRequest(BaseModel):
    """Execute a prompt against a live model from the studio test bench."""

    body: str
    system_body: str | None = None
    context: PromptContext
    values: dict[str, str] = Field(default_factory=dict)
    connection_id: UUID
    model_name: str = Field(min_length=1)
    output_fields: list[dict[str, object]] = Field(default_factory=list)


class PromptTestMessage(BaseModel):
    """One message of the payload the test bench actually sent."""

    role: Literal["system", "user"]
    content: str


class PromptTestRead(BaseModel):
    """The test bench outcome: the exact messages sent and what came back."""

    rendered: str
    rendered_system: str | None = None
    messages: list[PromptTestMessage] = Field(default_factory=list)
    response_text: str | None = None
    structured_output: dict[str, object] | None = None


class PromptSelectionRead(BaseModel):
    """A consumer's current prompt: the reference, entity, and rendering."""

    reference: PromptReference | None = None
    prompt: PromptRead | None = None
    body: str
    rendered: str
    context: dict[str, str]
    variables: list[PromptVariable]


class PromptSelectionUpdate(BaseModel):
    """Point a consumer at a library prompt (pin or latest)."""

    prompt_id: UUID
    version: PromptVersionSelector = "latest"


class PromptTemplateRead(BaseModel):
    """Legacy inline-template read shape (chat/collection prompt endpoints)."""

    template: str
    rendered: str
    context: dict[str, str]
    variables: list[PromptVariable]
    is_custom: bool = False


class PromptTemplateUpdate(BaseModel):
    """Legacy inline-template update payload."""

    template: str | None = None
