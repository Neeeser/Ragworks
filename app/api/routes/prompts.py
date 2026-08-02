"""Prompt library API routes: CRUD, versions, forks, preview, test bench."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import ExitStack
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session

from app.api.dependencies import get_current_user, get_session, oauth2_scheme
from app.api.routes.utils import to_http_exception
from app.db import models
from app.db.engine import stream_scoped_session
from app.prompting import catalog_for
from app.schemas.enums import PromptContext
from app.schemas.prompts import (
    PromptCatalogRead,
    PromptCreate,
    PromptDetailRead,
    PromptForkCreate,
    PromptNamespaceRead,
    PromptRead,
    PromptRenderRead,
    PromptRenderRequest,
    PromptTestErrorEvent,
    PromptTestRead,
    PromptTestRequest,
    PromptUpdate,
    PromptVersionCreate,
    PromptVersionRead,
)
from app.services.errors import ServiceError
from app.services.prompts.library import PromptLibraryService
from app.services.prompts.studio import render_preview, run_test, stream_test
from app.services.prompts.usage import prompt_usages

router = APIRouter(prefix="/api/prompts", tags=["prompts"])


def _read(prompt: models.Prompt) -> PromptRead:
    return PromptRead.model_validate(prompt, from_attributes=True)


@router.get("", response_model=list[PromptRead])
def list_prompts(
    context: PromptContext | None = None,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[PromptRead]:
    """List the user's prompts, optionally narrowed to one context."""
    prompts = PromptLibraryService(session).list_for_user(current_user.id)
    if context is not None:
        prompts = [prompt for prompt in prompts if prompt.context == context]
    return [_read(prompt) for prompt in prompts]


@router.get("/catalogs", response_model=list[PromptCatalogRead])
def list_catalogs() -> list[PromptCatalogRead]:
    """Return every context's variable catalog for the editor."""
    catalogs: list[PromptCatalogRead] = []
    for context in PromptContext:
        catalog = catalog_for(context)
        catalogs.append(
            PromptCatalogRead(
                context=context,
                variables=list(catalog.variables),
                namespaces=[
                    PromptNamespaceRead(
                        prefix=namespace.prefix,
                        description=namespace.description,
                        example_name=namespace.example_name,
                    )
                    for namespace in catalog.namespaces
                ],
            )
        )
    return catalogs


@router.post("/render", response_model=PromptRenderRead)
def render_prompt(
    payload: PromptRenderRequest,
    current_user: models.User = Depends(get_current_user),
) -> PromptRenderRead:
    """Render a draft template against example context, reporting findings."""
    return render_preview(payload)


@router.post("/test", response_model=PromptTestRead)
def run_prompt_test(
    payload: PromptTestRequest,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptTestRead:
    """Execute a prompt against a live model from the studio test bench."""
    try:
        return run_test(session, current_user, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.post("/test/stream")
def stream_prompt_test(
    payload: PromptTestRequest,
    request: Request,
    token: str = Depends(oauth2_scheme),
) -> StreamingResponse:
    """Stream a test run over SSE so the answer appears as it arrives.

    Setup runs synchronously so auth and validation failures surface as HTTP
    errors rather than mid-stream events; the generator outlives this handler,
    so it owns the session it was handed (mirrors `stream_chat`).
    """
    with ExitStack() as stack:
        session = stack.enter_context(stream_scoped_session())
        current_user = get_current_user(request=request, token=token, session=session)
        session_cleanup = stack.pop_all()

    def format_event(event: BaseModel) -> str:
        return f"data: {json.dumps(jsonable_encoder(event.model_dump()))}\n\n"

    def event_stream() -> Iterator[str]:
        events = iter(stream_test(session, current_user, payload))
        try:
            for event in events:
                yield format_event(event)
        except ServiceError as exc:
            yield format_event(PromptTestErrorEvent(message=exc.detail))
        except Exception as exc:
            yield format_event(PromptTestErrorEvent(message=str(exc) or "Test run failed."))
        finally:
            yield "data: [DONE]\n\n"
            session_cleanup.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def create_prompt(
    payload: PromptCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptRead:
    """Create a prompt whose v1 is the supplied body."""
    try:
        prompt = PromptLibraryService(session).create(current_user.id, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _read(prompt)


@router.get("/{prompt_id}", response_model=PromptDetailRead)
def get_prompt(
    prompt_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptDetailRead:
    """Return a prompt with its current body and usage listing."""
    service = PromptLibraryService(session)
    try:
        prompt = service.get(current_user.id, prompt_id)
        version = service.get_version(current_user.id, prompt_id, "latest")
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return PromptDetailRead(
        **_read(prompt).model_dump(),
        body=version.body,
        system_body=version.system_body,
        output_fields=version.output_fields,
        used_by=prompt_usages(session, current_user.id, prompt_id),
    )


@router.patch("/{prompt_id}", response_model=PromptRead)
def update_prompt(
    prompt_id: UUID,
    payload: PromptUpdate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptRead:
    """Rename or redescribe a prompt."""
    try:
        prompt = PromptLibraryService(session).update(current_user.id, prompt_id, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _read(prompt)


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(
    prompt_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> None:
    """Delete a prompt; refuses while anything references it."""
    try:
        PromptLibraryService(session).delete(current_user.id, prompt_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc


@router.get("/{prompt_id}/versions", response_model=list[PromptVersionRead])
def list_versions(
    prompt_id: UUID,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[PromptVersionRead]:
    """List a prompt's versions, newest first."""
    try:
        versions = PromptLibraryService(session).list_versions(current_user.id, prompt_id)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return [PromptVersionRead.model_validate(row, from_attributes=True) for row in versions]


@router.post(
    "/{prompt_id}/versions",
    response_model=PromptVersionRead,
    status_code=status.HTTP_201_CREATED,
)
def save_version(
    prompt_id: UUID,
    payload: PromptVersionCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptVersionRead:
    """Append a new immutable version and make it current."""
    try:
        version = PromptLibraryService(session).save_version(current_user.id, prompt_id, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return PromptVersionRead.model_validate(version, from_attributes=True)


@router.post("/{prompt_id}/fork", response_model=PromptRead, status_code=status.HTTP_201_CREATED)
def fork_prompt(
    prompt_id: UUID,
    payload: PromptForkCreate,
    current_user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PromptRead:
    """Create a new prompt seeded from one version of an existing one."""
    try:
        prompt = PromptLibraryService(session).fork(current_user.id, prompt_id, payload)
    except ServiceError as exc:
        raise to_http_exception(exc) from exc
    return _read(prompt)
