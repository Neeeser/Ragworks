"""Runtime behavior of variables: input node, retriever overrides, limit, outputs."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.execution.executor import PipelineExecutor
from app.pipelines.nodes.io import (
    RetrievalInputConfig,
    RetrievalInputNode,
    RetrievalOutputConfig,
    RetrievalOutputNode,
)
from app.pipelines.nodes.limiting import ResultLimitConfig, ResultLimitNode
from app.pipelines.nodes.retrieval import VectorRetrieverConfig, VectorRetrieverNode
from app.pipelines.payloads import RetrievalPayload, RetrievalRequestPayload
from app.pipelines.registry import build_default_registry
from app.pipelines.resolution import build_environment, resolve_definition
from app.pipelines.variables import (
    PipelineInputArgument,
    PipelineVariable,
    VariableSource,
    VariableType,
)
from app.retrieval.models import (
    DocumentChunk,
    DocumentMetadata,
    QueryRequest,
    RetrievalResponse,
    ScoredChunk,
)
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
    make_stub_embedder,
)


def _chunk(order: int) -> ScoredChunk:
    return ScoredChunk(
        chunk=DocumentChunk(
            document_id="doc",
            chunk_id=f"doc:{order}",
            text=f"chunk {order}",
            order=order,
            metadata=DocumentMetadata(),
        ),
        score=1.0 - order / 10,
    )


def _context(
    session: Session,
    *,
    query: str | None = "hello",
    top_k: int | None = None,
    vector_store: StubVectorStore | None = None,
    definition: PipelineDefinition | None = None,
    supplied: dict[str, object] | None = None,
) -> PipelineRunContext:
    """Build a node-test context; with `definition`, attach its built environment."""
    user = models.User(id=uuid4(), email="vars@test.local", hashed_password="hashed")
    collection = models.Collection(
        id=uuid4(), user_id=user.id, name="Vars", description="", extra_metadata={}
    )
    variables = None
    if definition is not None:
        variables = build_environment(definition, query=query, supplied=supplied)
    return PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=None,
        query=query,
        top_k=top_k,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(vector_store),
        storage=FileStorage(base_path=Path("/tmp/vars-tests")),
        settings=get_settings(),
        variables=variables,
    )


def _input_variable(argument: PipelineInputArgument) -> PipelineVariable:
    """Project the argument shape back onto an input-source variable."""
    return PipelineVariable(
        name=argument.name,
        type=argument.type,
        source=VariableSource.INPUT,
        description=argument.description,
        value=None if argument.required else argument.default,
        minimum=argument.minimum,
        maximum=argument.maximum,
        choices=list(argument.choices),
        expose_to_llm=argument.expose_to_llm,
    )


def _input_definition(arguments: list[PipelineInputArgument]) -> PipelineDefinition:
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="input",
                type=RetrievalInputNode.type,
                name="Input",
                config={"arguments": [argument.name for argument in arguments]},
            )
        ],
        variables=[_input_variable(argument) for argument in arguments],
    )


class TestRetrievalInputNode:
    """The input node reads the run's effective top_k off the context."""

    def test_uses_context_top_k(self, session: Session) -> None:
        context = _context(session, top_k=3)
        node = RetrievalInputNode(RetrievalInputConfig())
        payload = RetrievalRequestPayload.model_validate(node.run({}, context)["request"])
        assert payload.request.top_k == 3

    def test_legacy_default_is_five(self, session: Session) -> None:
        context = _context(session)
        node = RetrievalInputNode(RetrievalInputConfig())
        payload = RetrievalRequestPayload.model_validate(node.run({}, context)["request"])
        assert payload.request.top_k == 5


class TestRunnerEffectiveTopK:
    """PipelineRunner maps the declared result limit to the request boundary."""

    @staticmethod
    def _start(session: Session, **start_overrides: object):
        from app.pipelines.execution.runner import PipelineRunner
        from app.services.pipelines import PipelineService

        user = models.User(email="runner@test.local", hashed_password="hashed")
        session.add(user)
        session.commit()
        session.refresh(user)
        definition = _input_definition(
            [
                PipelineInputArgument(
                    name="result_limit", type=VariableType.INTEGER, default=7, minimum=1
                )
            ]
        )
        pipeline = PipelineService(session).create_pipeline(
            user=user,
            name="Args",
            definition=definition,
        )
        session.commit()
        collection = models.Collection(user_id=user.id, name="C", description="", extra_metadata={})
        session.add(collection)
        session.commit()
        session.refresh(collection)
        version = PipelineService(session).get_current_version(pipeline)
        runner = PipelineRunner(session)
        kwargs: dict[str, object] = {
            "pipeline": pipeline,
            "version": version,
            "definition": definition,
            "kind": models.PipelineKind.RETRIEVAL,
            "user": user,
            "collection": collection,
            "settings": get_settings(),
            "providers": StubProviderResolver(),
            "vector_stores": StubVectorStoreProvider(None),
            "storage": FileStorage(base_path=Path("/tmp/vars-tests")),
            "query": "hello",
        }
        kwargs.update(start_overrides)
        return runner.start(**kwargs)  # type: ignore[arg-type]

    def test_supplied_argument_becomes_context_top_k(self, session: Session) -> None:
        handle = self._start(session, top_k=3, arguments={"result_limit": 9})
        assert handle.context.top_k == 9

    def test_declared_default_beats_absent_request_value(self, session: Session) -> None:
        handle = self._start(session)
        assert handle.context.top_k == 7

    def test_request_top_k_feeds_declared_argument(self, session: Session) -> None:
        handle = self._start(session, top_k=3)
        assert handle.context.top_k == 3


class TestRetrieverTopKOverride:
    """The configured retriever top_k is the only depth source (an unset one
    is a run error — pinned in test_bm25_and_fusion_nodes)."""

    def test_config_top_k_reaches_store(self, session: Session) -> None:
        store = StubVectorStore(query_matches=[_chunk(0)])
        context = _context(session, vector_store=store)
        node = VectorRetrieverNode(
            VectorRetrieverConfig(backend="pgvector", index_name="docs", top_k=20)
        )
        request = QueryRequest(text="hello", top_k=5)
        node.run(
            {
                "query_embedding": {
                    "request": request.model_dump(),
                    "embedding": [0.1, 0.2],
                }
            },
            context,
        )
        assert store.query_calls[0]["top_k"] == 20


class TestResultLimitNode:
    """The clamp node truncates ordered results and traces the cut honestly."""

    def test_truncates_to_max_results(self, session: Session) -> None:
        matches = [_chunk(order) for order in range(5)]
        payload = RetrievalPayload(response=RetrievalResponse(matches=matches))
        node = ResultLimitNode(ResultLimitConfig(max_results=2))
        outputs = node.run({"results": payload}, _context(session))
        result = RetrievalPayload.model_validate(outputs["results"])
        assert [match.chunk.chunk_id for match in result.response.matches] == [
            "doc:0",
            "doc:1",
        ]

    def test_short_input_passes_through(self, session: Session) -> None:
        payload = RetrievalPayload(response=RetrievalResponse(matches=[_chunk(0)]))
        node = ResultLimitNode(ResultLimitConfig(max_results=10))
        outputs = node.run({"results": payload}, _context(session))
        result = RetrievalPayload.model_validate(outputs["results"])
        assert len(result.response.matches) == 1

    def test_unset_max_results_falls_back_to_requested_top_k(self, session: Session) -> None:
        matches = [_chunk(order) for order in range(5)]
        payload = RetrievalPayload(response=RetrievalResponse(matches=matches))
        node = ResultLimitNode(ResultLimitConfig())
        outputs = node.run({"results": payload}, _context(session, top_k=2))
        result = RetrievalPayload.model_validate(outputs["results"])
        assert len(result.response.matches) == 2
        summary = node.summarize_io({"results": payload}, outputs)
        kept = next(value.value for value in summary.outputs if value.label == "Kept")
        assert kept == {"max_results": 2, "kept": 2, "dropped": 3}

    def test_zero_requested_top_k_keeps_nothing(self, session: Session) -> None:
        """A falsy requested top_k is honored, not treated as 'unset'."""
        payload = RetrievalPayload(response=RetrievalResponse(matches=[_chunk(0), _chunk(1)]))
        node = ResultLimitNode(ResultLimitConfig())
        outputs = node.run({"results": payload}, _context(session, top_k=0))
        result = RetrievalPayload.model_validate(outputs["results"])
        assert result.response.matches == []

    def test_no_config_and_no_request_keeps_everything(self, session: Session) -> None:
        matches = [_chunk(order) for order in range(3)]
        payload = RetrievalPayload(response=RetrievalResponse(matches=matches))
        node = ResultLimitNode(ResultLimitConfig())
        outputs = node.run({"results": payload}, _context(session, top_k=None))
        result = RetrievalPayload.model_validate(outputs["results"])
        assert len(result.response.matches) == 3

    def test_trace_shows_full_input_and_kept_counts(self, session: Session) -> None:
        matches = [_chunk(order) for order in range(4)]
        payload = RetrievalPayload(response=RetrievalResponse(matches=matches))
        node = ResultLimitNode(ResultLimitConfig(max_results=3))
        outputs = node.run({"results": payload}, _context(session))
        summary = node.summarize_io({"results": payload}, outputs)
        kept = next(value.value for value in summary.outputs if value.label == "Kept")
        assert kept == {"max_results": 3, "kept": 3, "dropped": 1}
        candidate_items = next(
            value.value for value in summary.inputs if value.label == "Candidate items"
        )
        assert len(candidate_items.items) == 4


class TestRetrievalOutputNode:
    """Declared outputs evaluate against the run environment."""

    def test_outputs_evaluate(self, session: Session) -> None:
        definition = _input_definition(
            [PipelineInputArgument(name="top_k", type=VariableType.INTEGER, default=5)]
        )
        context = _context(session, definition=definition, supplied={"top_k": 4})
        node = RetrievalOutputNode(
            RetrievalOutputConfig.model_validate(
                {"outputs": [{"name": "candidates", "expression": "top_k * 2"}]}
            )
        )
        payload = RetrievalPayload(response=RetrievalResponse(matches=[]))
        result = RetrievalPayload.model_validate(node.run({"results": payload}, context)["result"])
        assert result.outputs == {"candidates": 8}

    def test_no_outputs_declared_is_passthrough(self, session: Session) -> None:
        context = _context(session)
        node = RetrievalOutputNode(RetrievalOutputConfig())
        payload = RetrievalPayload(response=RetrievalResponse(matches=[]))
        result = RetrievalPayload.model_validate(node.run({"results": payload}, context)["result"])
        assert result.outputs == {}

    def test_broken_output_expression_fails_the_run(self, session: Session) -> None:
        definition = _input_definition([])
        context = _context(session, definition=definition)
        node = RetrievalOutputNode(
            RetrievalOutputConfig.model_validate(
                {"outputs": [{"name": "bad", "expression": "missing_var"}]}
            )
        )
        payload = RetrievalPayload(response=RetrievalResponse(matches=[]))
        with pytest.raises(ValueError, match="Output 'bad'"):
            node.run({"results": payload}, context)


def test_end_to_end_over_retrieve_and_clamp(session: Session) -> None:
    """Argument -> expression over-retrieval -> limit clamp, through the executor."""
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(
                id="input",
                type="retrieval.input",
                name="Input",
                config={"arguments": ["top_k"]},
            ),
            PipelineNodeDefinition(
                id="embed",
                type="embedder.text",
                name="Embedder",
                config={"connection_id": str(uuid4()), "model_name": "test-embed"},
            ),
            PipelineNodeDefinition(
                id="retrieve",
                type="retriever.vector",
                name="Retriever",
                config={
                    "backend": "pgvector",
                    "index_name": "docs",
                    "top_k": {"$expr": "top_k * 2"},
                },
            ),
            PipelineNodeDefinition(
                id="limit",
                type="limit.results",
                name="Limit",
                config={"max_results": {"$expr": "top_k"}},
            ),
            PipelineNodeDefinition(
                id="output",
                type="retrieval.output",
                name="Output",
                config={"outputs": [{"name": "fetched", "expression": "top_k * 2"}]},
            ),
        ],
        edges=[
            {
                "id": "e1",
                "source": "input",
                "target": "embed",
                "source_port": "request",
                "target_port": "request",
            },
            {
                "id": "e2",
                "source": "embed",
                "target": "retrieve",
                "source_port": "query_embedding",
                "target_port": "query_embedding",
            },
            {
                "id": "e3",
                "source": "retrieve",
                "target": "limit",
                "source_port": "results",
                "target_port": "results",
            },
            {
                "id": "e4",
                "source": "limit",
                "target": "output",
                "source_port": "results",
                "target_port": "results",
            },
        ],
        variables=[
            _input_variable(
                PipelineInputArgument(name="top_k", type=VariableType.INTEGER, default=5, minimum=1)
            )
        ],
    )
    store = StubVectorStore(query_matches=[_chunk(order) for order in range(8)])
    context = _context(
        session,
        vector_store=store,
        definition=definition,
        supplied={"top_k": 3},
    )
    context.providers.embedder_cls = make_stub_embedder(query_result=[0.1, 0.2])
    environment = build_environment(definition, query="hello", supplied={"top_k": 3})
    resolved = resolve_definition(definition, environment)

    result = PipelineExecutor(build_default_registry()).execute(resolved, context)
    payload = next(
        RetrievalPayload.model_validate(outputs["result"])
        for outputs in result.terminal_outputs.values()
        if "result" in outputs
    )

    assert store.query_calls[0]["top_k"] == 6  # over-retrieved: top_k * 2
    assert len(payload.response.matches) == 3  # clamped back to top_k
    assert payload.outputs == {"fetched": 6}
