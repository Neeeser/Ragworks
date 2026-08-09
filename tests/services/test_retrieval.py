"""Behavior of ``RetrievalService`` (happy path, pipeline resolution, failures).

Merged from `test_retrieval_service_coverage.py`. `test_usage_tokens_prefers_known_keys`
was dropped along with the `_usage_tokens` method it tested: `payload.usage` is a typed
`TokenUsage` (two known fields), so there's no longer a dict of arbitrary keys to
normalize -- the happy-path test below asserts the replacement (`_context_tokens`)
indirectly through the persisted `QueryEvent.context_tokens`.
"""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from pinecone.exceptions import PineconeException
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import AppSettingRepository
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.media import QueryMediaPayload
from app.services.app_config import invalidate_app_config_cache
from app.services.errors import InvalidInputError
from app.services.pipelines import PipelineService
from app.services.retrieval import RetrievalService, store_query_media
from app.services.tool_invocation import RetrievalPipelineError, ToolInvocationService
from app.telemetry.events import RetrievalQueryRan
from app.utils.file_storage import FileStorage
from app.vectorstores.base import IndexSpec
from tests.utils.collections import bind_scaffolds
from tests.utils.providers import TEST_EMBED_CONNECTION_ID, install_scaffolded_pipelines
from tests.utils.vectors import pgvector_store


class _StubEmbedder:
    """Embedder stand-in: every text embeds to the same fixed vector."""

    def __init__(self, model_name: str) -> None:
        self.model_name = model_name

    @property
    def usage(self) -> dict[str, int] | None:
        return {"prompt_tokens": 5, "total_tokens": 5}

    def embed_documents(self, chunks):
        return [[0.1, 0.2, 0.3] for _ in chunks]

    def embed_query(self, _query: str):
        return [0.1, 0.2, 0.3]


class _StubProviderResolver:
    """ProviderResolver stand-in serving `_StubEmbedder` for any connection."""

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return _StubEmbedder(model_name)


def _create_user(session: Session) -> models.User:
    user = models.User(
        email="retrieval@example.com",
        full_name="Retrieval User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    install_scaffolded_pipelines(session, user)
    return user


def _create_collection(
    session: Session, user: models.User, **overrides: object
) -> models.Collection:
    """A collection with both bindings, the way the app creates one."""
    return bind_scaffolds(session, user, _unbound_collection(session, user, **overrides))


def _unbound_collection(
    session: Session, user: models.User, **overrides: object
) -> models.Collection:
    """A collection row holding no bindings — only reachable as broken data."""
    defaults: dict[str, object] = {
        "user_id": user.id,
        "name": "Collection",
        "description": "",
        "extra_metadata": {},
    }
    defaults.update(overrides)
    collection = models.Collection(**defaults)  # type: ignore[arg-type]
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _bind_default_pipelines(
    session: Session, user: models.User, collection: models.Collection
) -> None:
    """Bind the user's default pipelines, the way collection creation does.

    `query_arguments` resolves read-only, so a collection built straight
    through the model layer has no bindings for it to read until something
    writes them.
    """
    scaffolds = install_scaffolded_pipelines(session, user)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=scaffolds.ingestion.id,
            role=models.BindingRole.INGEST,
        )
    )
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=scaffolds.retrieval.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
    )
    session.commit()


def test_query_collection_happy_path_maps_chunks_and_records_event(
    monkeypatch, pgvector_session: Session
) -> None:
    """A successful query maps vector-store matches onto `RetrievedChunk`s and
    records a `QueryEvent` carrying the same latency/usage/pipeline-run data
    the response reports."""
    session = pgvector_session
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)

    user = _create_user(session)
    collection = _create_collection(session, user)
    service = RetrievalService(session)

    store = pgvector_store(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    store.upsert(
        "ragworks",
        f"col-{collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id="chunk-1",
                text="Paris is the capital of France.",
                order=0,
                metadata=DocumentMetadata(data={}),
                embedding=[0.1, 0.2, 0.3],
            )
        ],
    )

    response = service.query_collection(user, collection, query="capital of France", top_k=3)

    assert response.query == "capital of France"
    assert response.top_k == 3
    assert len(response.chunks) == 1
    chunk = response.chunks[0]
    assert chunk.chunk_id == "chunk-1"
    assert chunk.document_id == "doc-1"
    # The hybrid default fuses branches by reciprocal rank: the sole dense
    # match at rank 1 scores 1/(60+1); raw cosine similarity is replaced.
    assert chunk.score == pytest.approx(1 / 61, abs=1e-9)
    assert chunk.text == "Paris is the capital of France."
    assert response.usage == {"prompt_tokens": 5, "total_tokens": 5}
    assert response.query_event_id is not None
    assert response.pipeline_run_id is not None

    event = session.get(models.QueryEvent, response.query_event_id)
    assert event is not None
    assert event.query_text == "capital of France"
    assert event.top_k == 3
    assert event.latency_ms >= 0
    assert event.context_tokens == 5
    assert event.pipeline_run_id == response.pipeline_run_id
    assert event.response_payload["match_count"] == 1


def test_query_collection_rejects_missing_pipeline(session: Session) -> None:
    user = _create_user(session)
    pipeline = PipelineService(session).create_pipeline(
        user=user,
        name="Ingestion",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()
    collection = _unbound_collection(session, user)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=pipeline.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
    )
    session.commit()
    service = RetrievalService(session)

    with pytest.raises(InvalidInputError, match="has no query input"):
        service.query_collection(user, collection, query="hello")


def test_query_collection_marks_run_failed_on_exception(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _unbound_collection(session, user)
    service = RetrievalService(session)

    defaults = install_scaffolded_pipelines(session, user)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=defaults.retrieval.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
    )
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, _context):
            raise RuntimeError("boom")

    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)

    # An internal bug surfaces as a structured RetrievalPipelineError pinned to
    # 500 (not the bare RuntimeError), still carrying the run id for the trace.
    with pytest.raises(RetrievalPipelineError) as caught:
        service.query_collection(user, collection, query="hello")
    assert caught.value.status_code == 500
    assert caught.value.detail["pipeline_run_id"] is not None  # type: ignore[index]

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED
    assert run.error_message == "boom"


def test_query_collection_wraps_pinecone_outage_as_external_service_error(
    monkeypatch, session: Session
) -> None:
    """A Pinecone outage mid-query surfaces as a structured RetrievalPipelineError
    pinned to 502 (external provider fault), carrying the run id for the trace
    link -- while still marking the run FAILED. The raw SDK message lives in the
    trace, not the primary error message."""
    user = _create_user(session)
    collection = _unbound_collection(session, user)
    service = RetrievalService(session)

    defaults = install_scaffolded_pipelines(session, user)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=defaults.retrieval.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
    )
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, _context):
            raise PineconeException("Pinecone is unavailable")

    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)

    with pytest.raises(RetrievalPipelineError) as caught:
        service.query_collection(user, collection, query="hello")
    assert caught.value.status_code == 502
    assert caught.value.detail["code"] == "retrieval_pipeline_failed"  # type: ignore[index]
    assert "Pinecone is unavailable" not in caught.value.detail["message"]  # type: ignore[index]

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED


def test_query_collection_skips_failed_run_update(monkeypatch, session: Session) -> None:
    user = _create_user(session)
    collection = _unbound_collection(session, user)
    service = RetrievalService(session)

    defaults = install_scaffolded_pipelines(session, user)
    session.add(
        models.CollectionPipelineBinding(
            collection_id=collection.id,
            pipeline_id=defaults.retrieval.id,
            role=models.BindingRole.TOOL,
            is_primary=True,
        )
    )
    session.commit()

    class _StubExecutor:
        def __init__(self, _registry) -> None:
            pass

        def execute(self, _definition, context):
            context.trace._run.status = models.PipelineRunStatus.FAILED
            raise RuntimeError("boom")

    monkeypatch.setattr("app.pipelines.execution.runner.PipelineExecutor", _StubExecutor)
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)

    with pytest.raises(RetrievalPipelineError):
        service.query_collection(user, collection, query="hello")

    run = session.exec(select(models.PipelineRun)).first()
    assert run is not None
    assert run.status == models.PipelineRunStatus.FAILED


def test_query_collection_failure_carries_failed_node_and_run(
    monkeypatch, pgvector_session: Session
) -> None:
    """Regression: a node failing mid-retrieval yields a structured error whose
    detail names the failed node and the run id (both used to be discarded).

    Red-green: before the fix the service re-raised the bare embedder error
    with no `failed_node`/`pipeline_run_id`; the assertions below fail.
    """
    session = pgvector_session

    class _FailingEmbedder:
        def __init__(self, model_name: str) -> None:
            self.model_name = model_name

        @property
        def usage(self) -> dict[str, int] | None:
            return None

        def embed_query(self, _query: str):
            raise RuntimeError("embed boom")

        def embed_documents(self, chunks):
            return [[0.1, 0.2, 0.3] for _ in chunks]

    class _FailingResolver:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def embedder(self, _connection_id, model_name: str, dimensions=None):
            del dimensions
            return _FailingEmbedder(model_name)

    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _FailingResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)

    with pytest.raises(RetrievalPipelineError) as caught:
        RetrievalService(session).query_collection(user, collection, query="hello")

    detail = caught.value.detail
    assert detail["pipeline_run_id"] is not None  # type: ignore[index]
    assert detail["failed_node"] is not None  # type: ignore[index]
    assert detail["failed_node"]["node_type"]  # type: ignore[index]
    assert caught.value.status_code == 500


def test_query_collection_db_error_surfaces_as_structured_failure(
    monkeypatch, pgvector_session: Session
) -> None:
    """Regression: a mid-run DB error (a vector-dimension mismatch) must still
    surface as a structured RetrievalPipelineError, not a raw 500.

    The DB error aborts the transaction, so reading the failed node with a
    SELECT would raise inside the failure handler (`InternalError` from a
    query-invoked autoflush) and lose the structured detail — exactly the bug
    the sandbox e2e caught. Red-green: before reading the failed node from the
    in-memory trace instead of the poisoned session, this raised the SQLAlchemy
    error, not `RetrievalPipelineError`.
    """
    session = pgvector_session

    class _WrongDimEmbedder:
        """Indexes at 3d but embeds queries at 5d — a real pgvector mismatch."""

        def __init__(self, model_name: str) -> None:
            self.model_name = model_name

        @property
        def usage(self) -> dict[str, int] | None:
            return None

        def embed_query(self, _query: str):
            return [0.1, 0.2, 0.3, 0.4, 0.5]

        def embed_documents(self, chunks):
            return [[0.1, 0.2, 0.3] for _ in chunks]

    class _WrongDimResolver:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def embedder(self, _connection_id, model_name: str, dimensions=None):
            del dimensions
            return _WrongDimEmbedder(model_name)

    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _WrongDimResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)

    store = pgvector_store(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    store.upsert(
        "ragworks",
        f"col-{collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id="chunk-1",
                text="Paris is the capital of France.",
                order=0,
                metadata=DocumentMetadata(data={}),
                embedding=[0.1, 0.2, 0.3],
            )
        ],
    )

    with pytest.raises(RetrievalPipelineError) as caught:
        RetrievalService(session).query_collection(user, collection, query="capital?")
    assert caught.value.detail["pipeline_run_id"] is not None  # type: ignore[index]
    assert caught.value.status_code == 500


def test_extract_retrieval_payload_raises_for_missing_result() -> None:
    """Pure-function edge case, kept as a direct test for the same reason as
    `IngestionService._extract_indexing_payload`'s test (see test_ingestion.py):
    it's pure data-in/data-out validation, not wiring."""
    with pytest.raises(InvalidInputError, match="retrieval result payload"):
        ToolInvocationService._extract_payload({"node": {"data": {}}})


def _declare_pipeline_variables(
    session: Session,
    user: models.User,
    *,
    arguments: list[dict[str, object]],
    outputs: list[dict[str, str]] | None = None,
    retriever_top_k_expression: str | None = None,
) -> None:
    """Rewrite the user's default retrieval pipeline with declared input variables.

    Index variables survive the rewrite: a store-bound node's identity is an
    expression over them, so replacing the whole list would leave the graph
    referencing variables that no longer exist.
    """
    from app.pipelines.definition import PipelineDefinition
    from app.pipelines.variables import PipelineVariable, VariableSource

    pipeline = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == "default-search",
        )
    ).one()
    service = PipelineService(session)
    version = service.get_current_version(pipeline)
    definition = PipelineDefinition.model_validate(version.definition)
    # The scaffold's index variables stay: the node identity fields are
    # expressions over them, so dropping them leaves the graph referencing
    # variables that no longer exist.
    index_variables = [
        variable for variable in definition.variables if variable.type == "index"
    ]
    definition.variables = [
        *index_variables,
        *(
            PipelineVariable.model_validate(
                {
                    "source": VariableSource.INPUT,
                    "value": argument.get("default"),
                    **{
                        key: value
                        for key, value in argument.items()
                        if key not in ("default", "required")
                    },
                }
            )
            for argument in arguments
        ),
    ]
    names = [str(argument["name"]) for argument in arguments]
    for node in definition.nodes:
        if node.type == "retrieval.input":
            node.config = {**node.config, "arguments": names}
        if outputs is not None and node.type == "retrieval.output":
            node.config = {**node.config, "outputs": outputs}
        if retriever_top_k_expression is not None and node.type == "retriever.vector":
            node.config = {**node.config, "top_k": {"$expr": retriever_top_k_expression}}
        if node.type == "limit.results" and "result_limit" not in names:
            # This helper replaces the scaffold variables. Point the final cut
            # at a custom top_k argument when present; otherwise leave it unset.
            node.config = (
                {**node.config, "max_results": {"$expr": "top_k"}}
                if "top_k" in names
                else {key: value for key, value in node.config.items() if key != "max_results"}
            )
        if (
            node.type in ("retriever.vector", "retriever.bm25")
            and "result_limit" not in names
            and not (node.type == "retriever.vector" and retriever_top_k_expression is not None)
        ):
            node.config = {
                **node.config,
                "top_k": {"$expr": "top_k"} if "top_k" in names else 5,
            }
    service.update_pipeline(
        pipeline=pipeline, definition=definition, change_summary="Declare arguments."
    )
    session.commit()


def test_query_arguments_declare_the_default_pipelines_result_limit(session: Session) -> None:
    user = _create_user(session)
    collection = _unbound_collection(session, user)
    _bind_default_pipelines(session, user, collection)
    response = RetrievalService(session).query_arguments(user, collection)
    assert [argument.name for argument in response.arguments] == ["result_limit"]


def test_query_arguments_refuse_an_unbound_collection_rather_than_binding_one(
    session: Session,
) -> None:
    """The endpoint behind this is a GET, so it may not write bindings."""
    user = _create_user(session)
    collection = _unbound_collection(session, user)

    with pytest.raises(InvalidInputError):
        RetrievalService(session).query_arguments(user, collection)

    bindings = session.exec(
        select(models.CollectionPipelineBinding).where(
            models.CollectionPipelineBinding.collection_id == collection.id
        )
    ).all()
    assert list(bindings) == []


def test_query_arguments_empty_when_pipeline_declares_none(session: Session) -> None:
    user = _create_user(session)
    collection = _unbound_collection(session, user)
    _bind_default_pipelines(session, user, collection)
    _declare_pipeline_variables(session, user, arguments=[])
    response = RetrievalService(session).query_arguments(user, collection)
    assert response.arguments == []


def test_query_arguments_lists_declared_arguments(session: Session) -> None:
    user = _create_user(session)
    collection = _unbound_collection(session, user)
    _bind_default_pipelines(session, user, collection)
    _declare_pipeline_variables(
        session,
        user,
        arguments=[
            {
                "name": "top_k",
                "type": "integer",
                "default": 5,
                "minimum": 1,
                "maximum": 10,
                "expose_to_llm": True,
            },
            {
                "name": "mode",
                "type": "enum",
                "default": "fast",
                "choices": ["fast", "deep"],
            },
        ],
    )
    response = RetrievalService(session).query_arguments(user, collection)
    assert [argument.name for argument in response.arguments] == ["top_k", "mode"]
    top_k = response.arguments[0]
    assert top_k.type == "integer"
    assert top_k.default == 5
    assert top_k.maximum == 10
    assert top_k.expose_to_llm is True
    assert response.arguments[1].choices == ["fast", "deep"]


def test_query_collection_rejects_unknown_argument(monkeypatch, session: Session) -> None:
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    with pytest.raises(InvalidInputError, match="Unknown argument 'nope'"):
        RetrievalService(session).query_collection(
            user, collection, query="hello", arguments={"nope": 1}
        )
    # Rejected input never records a run.
    assert session.exec(select(models.PipelineRun)).first() is None


def test_query_collection_rejects_constraint_violation(monkeypatch, session: Session) -> None:
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _declare_pipeline_variables(
        session,
        user,
        arguments=[{"name": "top_k", "type": "integer", "default": 5, "minimum": 1, "maximum": 10}],
    )
    with pytest.raises(InvalidInputError, match="must be at most 10"):
        RetrievalService(session).query_collection(
            user, collection, query="hello", arguments={"top_k": 99}
        )


def test_query_collection_arguments_drive_over_retrieval_and_outputs(
    monkeypatch, pgvector_session: Session
) -> None:
    """Declared arguments flow into expressions (retriever top_k) and declared
    outputs come back on the response and the recorded QueryEvent."""
    session = pgvector_session
    recorded_events: list[RetrievalQueryRan] = []
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _StubProviderResolver)
    monkeypatch.setattr("app.services.tool_invocation.record", recorded_events.append)
    user = _create_user(session)
    collection = _create_collection(session, user)
    _declare_pipeline_variables(
        session,
        user,
        arguments=[
            {
                "name": "result_limit",
                "type": "integer",
                "default": 5,
                "minimum": 1,
                "maximum": 10,
            }
        ],
        outputs=[{"name": "candidates", "expression": "result_limit * 2"}],
        retriever_top_k_expression="result_limit * 2",
    )

    store = pgvector_store(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    store.upsert(
        "ragworks",
        f"col-{collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id=f"chunk-{order}",
                text=f"Paris fact {order}.",
                order=order,
                metadata=DocumentMetadata(data={}),
                embedding=[0.1, 0.2, 0.3],
            )
            for order in range(4)
        ],
    )

    response = RetrievalService(session).query_collection(
        user, collection, query="capital of France", arguments={"result_limit": 2}
    )

    assert response.top_k == 2
    assert response.outputs == {"candidates": 4}
    # The declared result_limit (2) caps the fused list even though the
    # retriever over-fetched 4 candidates.
    assert len(response.chunks) == 2

    event = session.get(models.QueryEvent, response.query_event_id)
    assert event is not None
    assert event.top_k == 2
    assert event.response_payload["arguments"] == {"result_limit": 2}
    assert event.response_payload["outputs"] == {"candidates": 4}
    assert len(recorded_events) == 1
    assert recorded_events[0].top_k == 2


class _MultimodalResolver:
    """ProviderResolver stand-in whose model reads text and images alike."""

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def embedder(self, _connection_id, model_name: str, dimensions=None):
        del dimensions
        return _MultimodalEmbedder(model_name)

    def input_modalities(self, _connection_id, _model_name, _kind) -> frozenset[str]:
        return frozenset({"text", "image"})


class _MultimodalEmbedder(_StubEmbedder):
    """Embeds images to a vector distinct from the text one."""

    def embed_images(self, images):
        return [[0.1, 0.2, 0.3] for _ in images]


def _png_payload() -> QueryMediaPayload:
    data = (Path(__file__).parent.parent / "assets" / "diagram.png").read_bytes()
    return QueryMediaPayload(
        media_type="image/png", data=base64.b64encode(data).decode("ascii")
    )


class TestStoreQueryMedia:
    """The write half of an image query: where bytes land, and what is refused."""

    def test_stores_the_image_under_the_collection(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)

        asset = store_query_media(collection, _png_payload())

        assert asset.path.startswith(f"collections/{collection.id}/queries/")
        assert asset.path.endswith(".png")
        assert asset.media_type == "image/png"
        assert asset.byte_size > 0
        assert asset.width is not None
        assert asset.height is not None
        # The bytes are really on disk, at the path the response hands back.
        assert FileStorage().read_bytes(asset.path)

    def test_rejects_an_unsupported_media_type(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        payload = QueryMediaPayload(media_type="image/tiff", data="AAAA")

        with pytest.raises(InvalidInputError, match="not a supported image type"):
            store_query_media(collection, payload)

    def test_rejects_data_that_is_not_base64(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        payload = QueryMediaPayload(media_type="image/png", data="not base64!!")

        with pytest.raises(InvalidInputError, match="not valid base64"):
            store_query_media(collection, payload)

    def test_rejects_base64_that_is_not_an_image(self, session: Session) -> None:
        user = _create_user(session)
        collection = _create_collection(session, user)
        payload = QueryMediaPayload(
            media_type="image/png", data=base64.b64encode(b"plain text").decode("ascii")
        )

        with pytest.raises(InvalidInputError, match="not a decodable image"):
            store_query_media(collection, payload)

    def test_rejects_an_image_over_the_configured_limit(self, session: Session) -> None:
        """The configured cap is enforced, not merely stored."""
        user = _create_user(session)
        collection = _create_collection(session, user)
        settings_repo = AppSettingRepository(session)
        settings_repo.upsert("uploads.max_image_upload_size_mb", 1, updated_by=None)
        session.commit()
        invalidate_app_config_cache()
        try:
            oversize = base64.b64encode(b"\x89PNG" + b"\0" * (2 * 1024 * 1024)).decode("ascii")
            payload = QueryMediaPayload(media_type="image/png", data=oversize)
            with pytest.raises(InvalidInputError, match="exceeds the configured 1MB"):
                store_query_media(collection, payload)
        finally:
            settings_repo.delete("uploads.max_image_upload_size_mb")
            session.commit()
            invalidate_app_config_cache()


def test_query_collection_carries_stored_media_through_the_run(
    monkeypatch, pgvector_session: Session
) -> None:
    """An image query reaches the pipeline as a stored reference, comes back on
    the response, and is recorded on the query event."""
    session = pgvector_session
    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _MultimodalResolver)

    user = _create_user(session)
    collection = _create_collection(session, user)
    asset = store_query_media(collection, _png_payload())

    store = pgvector_store(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    store.upsert(
        "ragworks",
        f"col-{collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id="chunk-1",
                text="[image: page.pdf, page 3]",
                order=0,
                metadata=DocumentMetadata(data={}),
                embedding=[0.1, 0.2, 0.3],
            )
        ],
    )

    response = RetrievalService(session).query_collection(
        user, collection, query="", top_k=3, query_media=asset
    )

    assert response.query_media is not None
    assert response.query_media.path == asset.path
    assert response.query_media.media_type == "image/png"
    # The dense branch answered from the image; the lexical branch had no
    # text to match on and contributed nothing rather than failing the run.
    assert [chunk.chunk_id for chunk in response.chunks] == ["chunk-1"]

    event = session.get(models.QueryEvent, response.query_event_id)
    assert event is not None
    assert event.response_payload["query_media"] == asset.model_dump()


def test_db_error_on_a_saved_pipeline_leaves_the_run_and_its_trace_readable(
    monkeypatch, pgvector_session: Session
) -> None:
    """A DB-level node failure on an ordinary run keeps its trace persistable.

    This is the non-draft path -- a saved pipeline invoked as a tool -- and
    the failure is a real pgvector dimension mismatch, so the transaction is
    aborted at the moment the node raises. Everything that records the
    failure afterwards is a write on that same session, so without the
    executor's per-node savepoint the run is left RUNNING with no node rows
    and the request dies on `InFailedSqlTransaction`. What the trace UI needs
    is exactly what is asserted here: a FAILED run, and the node that failed
    named on its own row.
    """
    session = pgvector_session

    class _WrongDimEmbedder:
        def __init__(self, model_name: str) -> None:
            self.model_name = model_name

        @property
        def usage(self) -> dict[str, int] | None:
            return None

        def embed_query(self, _query: str):
            return [0.1, 0.2, 0.3, 0.4, 0.5]

        def embed_documents(self, chunks):
            return [[0.1, 0.2, 0.3] for _ in chunks]

    class _WrongDimResolver:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def embedder(self, _connection_id, model_name: str, dimensions=None):
            del dimensions
            return _WrongDimEmbedder(model_name)

    monkeypatch.setattr("app.services.tool_invocation.ProviderResolver", _WrongDimResolver)
    user = _create_user(session)
    collection = _create_collection(session, user)

    store = pgvector_store(session)
    store.create_index(IndexSpec(name="ragworks", dimension=3, metric="cosine"))
    store.upsert(
        "ragworks",
        f"col-{collection.id}",
        [
            DocumentChunk(
                document_id="doc-1",
                chunk_id="chunk-1",
                text="Paris is the capital of France.",
                order=0,
                metadata=DocumentMetadata(data={}),
                embedding=[0.1, 0.2, 0.3],
            )
        ],
    )

    with pytest.raises(RetrievalPipelineError):
        RetrievalService(session).query_collection(user, collection, query="capital?")

    # Reading any of this is what fails on an aborted transaction.
    session.commit()
    with Session(session.get_bind()) as fresh:
        run = fresh.exec(select(models.PipelineRun)).first()
        assert run is not None
        assert run.status == models.PipelineRunStatus.FAILED
        # An ordinary run, not an editor experiment.
        assert run.is_draft is False
        node_runs = fresh.exec(
            select(models.PipelineNodeRun).where(models.PipelineNodeRun.run_id == run.id)
        ).all()
        failed = [n for n in node_runs if n.status == models.PipelineRunStatus.FAILED]
        assert len(failed) == 1
        assert "retriev" in failed[0].node_type
        # Nodes that ran before the failure kept their rows.
        assert any(n.status == models.PipelineRunStatus.COMPLETED for n in node_runs)
