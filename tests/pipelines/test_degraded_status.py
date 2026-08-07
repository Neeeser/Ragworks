"""A pass-through LLM failure settles the node and the run as degraded.

Driven through `PipelineExecutor` with a real trace recorder over
`retrieval.input -> llm.generate`, because what this pins is a status
roll-up rather than a node's return value: a HyDE generator whose provider
429s emits the original query, and a `completed` node inside a `completed`
run makes that indistinguishable from a run where it generated anything.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import httpx
import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutor
from app.pipelines.nodes.io import RetrievalInputNode
from app.pipelines.nodes.llm_generate import LlmGenerateNode
from app.pipelines.payloads import ItemBatch
from app.pipelines.registry import NodeRegistry
from app.pipelines.tracing import PipelineTraceRecorder
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubChatProvider,
    StubProviderResolver,
    StubVectorStoreProvider,
)

CONNECTION_ID = uuid4()
QUERY = "what is x?"


@pytest.fixture(autouse=True)
def _no_real_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retry backoff must never wait out real time in these tests."""
    monkeypatch.setattr("app.providers.throttle.time.sleep", lambda _: None)


def _rate_limited() -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://provider.test/chat")
    response = httpx.Response(429, request=request)
    return httpx.HTTPStatusError("rate limited", request=request, response=response)


def _definition(**config_overrides: Any) -> PipelineDefinition:
    """`retrieval.input -> llm.generate`, the HyDE shape from the report."""
    config: dict[str, Any] = {
        "connection_id": str(CONNECTION_ID),
        "model_name": "stub-model",
        "prompt": "Write a passage answering: {{text}}",
        "output_fields": [
            {"name": "passages", "type": "string_list", "target": {"kind": "items"}}
        ],
        **config_overrides,
    }
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="retrieval.input", name="Query", config={}),
            PipelineNodeDefinition(id="hyde", type="llm.generate", name="HyDE", config=config),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-1",
                source="input",
                target="hyde",
                source_port="items",
                target_port="items",
            )
        ],
    )


def _run_context(
    session: Session,
    definition: PipelineDefinition,
    responses: list[Any],
) -> tuple[models.PipelineRun, PipelineRunContext]:
    """A persisted query-time run traced against a canned chat provider."""
    user = models.User(email=f"deg-{uuid4().hex[:6]}@example.com", hashed_password="hashed")
    session.add(user)
    session.commit()
    collection = models.Collection(
        user_id=user.id, name="Degraded", description="", extra_metadata={}
    )
    session.add(collection)
    session.commit()
    pipeline = models.Pipeline(
        user_id=user.id, name="Retrieval", trigger=models.BindingRole.TOOL, current_version=1
    )
    session.add(pipeline)
    session.flush()
    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version=1,
        trigger=models.BindingRole.TOOL,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.RUNNING,
    )
    session.add(run)
    session.flush()
    context = PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        # No document: a query-time run, the kind that passes through.
        document=None,
        query=QUERY,
        top_k=None,
        providers=StubProviderResolver(chat_provider=StubChatProvider(responses=responses)),
        vector_stores=StubVectorStoreProvider(),
        storage=FileStorage(),
        settings=get_settings(),
        trace=PipelineTraceRecorder(session, run, definition),
    )
    return run, context


def _executor() -> PipelineExecutor:
    return PipelineExecutor(NodeRegistry([RetrievalInputNode, LlmGenerateNode]))


def _node_run(session: Session, run: models.PipelineRun, node_id: str) -> models.PipelineNodeRun:
    session.flush()
    statement = select(models.PipelineNodeRun).where(
        models.PipelineNodeRun.run_id == run.id,
        models.PipelineNodeRun.node_id == node_id,
    )
    return session.exec(statement).one()


def test_pass_through_failure_degrades_the_node_and_the_run(session: Session) -> None:
    """The reported bug: green 'Done' over a HyDE that never generated."""
    definition = _definition()
    run, context = _run_context(session, definition, [_rate_limited() for _ in range(5)])

    result = _executor().execute(definition, context)
    session.commit()

    batch = ItemBatch.model_validate(result.outputs_by_node["hyde"]["items"])
    assert [item.text for item in batch.items] == [QUERY]  # the pass-through itself
    node_run = _node_run(session, run, "hyde")
    assert node_run.status == models.PipelineRunStatus.DEGRADED
    assert node_run.error_message is not None and "rate limited" in node_run.error_message
    assert run.status == models.PipelineRunStatus.DEGRADED
    # The node before it did its job and says so — degradation is per node.
    assert _node_run(session, run, "input").status == models.PipelineRunStatus.COMPLETED


def test_a_successful_run_still_completes(session: Session) -> None:
    """The degraded path must not shadow the ordinary success status."""
    definition = _definition()
    run, context = _run_context(
        session,
        definition,
        [{"role": "assistant", "content": '{"passages": ["a hypothetical passage"]}'}],
    )

    result = _executor().execute(definition, context)
    session.commit()

    batch = ItemBatch.model_validate(result.outputs_by_node["hyde"]["items"])
    assert [item.text for item in batch.items] == ["a hypothetical passage"]
    assert _node_run(session, run, "hyde").status == models.PipelineRunStatus.COMPLETED
    assert run.status == models.PipelineRunStatus.COMPLETED


def test_on_failure_fail_fails_the_node_and_the_run(session: Session) -> None:
    """`fail` refuses the degraded result instead of publishing one."""
    definition = _definition(on_failure="fail")
    run, context = _run_context(session, definition, [_rate_limited() for _ in range(5)])

    with pytest.raises(httpx.HTTPStatusError):
        _executor().execute(definition, context)
    session.commit()

    assert _node_run(session, run, "hyde").status == models.PipelineRunStatus.FAILED
    assert run.status == models.PipelineRunStatus.FAILED
