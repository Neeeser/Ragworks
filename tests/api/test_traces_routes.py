from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.routes import traces as traces_routes
from app.db import models
from app.pipelines.defaults import build_default_ingestion_pipeline
from app.schemas.traces import PipelineTraceResponse
from app.services.pipelines import PipelineService
from app.services.traces import TraceNotFoundError, TraceService
from tests.utils.providers import TEST_EMBED_CONNECTION_ID


def _create_user(session: Session) -> models.User:
    user = models.User(
        email=f"trace-{uuid4().hex[:6]}@example.com",
        full_name="Trace User",
        hashed_password="hashed",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _create_pipeline(session: Session, user: models.User) -> models.Pipeline:
    service = PipelineService(session)
    pipeline = service.create_pipeline(
        user=user,
        name="Pipeline",
        definition=build_default_ingestion_pipeline(
            embedding_connection_id=TEST_EMBED_CONNECTION_ID, embedding_model="test-embed"
        ),
    )
    session.commit()
    session.refresh(pipeline)
    return pipeline


def _create_run(
    session: Session,
    user: models.User,
    pipeline: models.Pipeline,
    collection: models.Collection,
) -> models.PipelineRun:
    run = models.PipelineRun(
        pipeline_id=pipeline.id,
        pipeline_version_id=None,
        pipeline_version=pipeline.current_version,
        trigger=models.BindingRole.INGEST,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def _create_collection(session: Session, user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=user.id,
        name="Trace Collection",
        description="",
        extra_metadata={},
    )
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_trace_service_resolves_definition_from_pipeline_version(session: Session) -> None:
    """`TraceService` prefers the run's own pinned `PipelineVersion` when resolving
    the definition, over the pipeline's current version.

    This used to be `traces_routes._resolve_definition`; the behavior moved to
    `TraceService` (private `_resolve_definition`, exercised here through the
    public `get_run_trace`), and the route now just translates
    `TraceNotFoundError` to a 404.
    """
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)
    version = session.exec(
        select(models.PipelineVersion).where(
            models.PipelineVersion.pipeline_id == pipeline.id,
            models.PipelineVersion.version == pipeline.current_version,
        )
    ).first()
    assert version is not None
    collection = _create_collection(session, user)
    run = _create_run(session, user, pipeline, collection)
    run.pipeline_version_id = version.id
    session.add(run)
    session.commit()

    response = TraceService(session).get_run_trace(run.id, user.id)

    expected = PipelineService(session).get_definition(pipeline)
    assert response.definition.nodes == expected.nodes


def test_trace_service_falls_back_to_pipeline_when_version_missing(session: Session) -> None:
    """`pipeline_version_id` points nowhere (never committed -- Postgres would
    reject the FK) but the run is already identity-mapped in `session`, so
    `get_run_trace`'s own lookup finds the dirty in-memory instance without a
    flush as long as autoflush is suppressed around the call."""
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)
    collection = _create_collection(session, user)
    run = _create_run(session, user, pipeline, collection)
    expected = PipelineService(session).get_definition(pipeline)
    run.pipeline_version_id = uuid4()
    session.add(run)

    with session.no_autoflush:
        response = TraceService(session).get_run_trace(run.id, user.id)

    assert response.definition.nodes == expected.nodes


def test_trace_service_rejects_run_with_missing_pipeline(session: Session) -> None:
    """`pipeline_id` is a real FK against `pipelines.id`, so a run pointing at a
    nonexistent pipeline can never actually be committed -- this exercises the
    defensive branch via the in-memory run directly, same as the original
    test did against the (now-removed) route-level `_resolve_definition`."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    run = models.PipelineRun(
        pipeline_id=uuid4(),
        pipeline_version_id=None,
        pipeline_version=1,
        trigger=models.BindingRole.TOOL,
        user_id=user.id,
        collection_id=collection.id,
        status=models.PipelineRunStatus.COMPLETED,
    )

    with pytest.raises(TraceNotFoundError):
        TraceService(session)._resolve_definition(run)  # pylint: disable=protected-access


def test_trace_service_get_run_trace_returns_payload(session: Session) -> None:
    """Direct service-level check that `get_run_trace` returns a full payload
    for the run id (distinct from `test_get_pipeline_run_trace_success` below,
    which exercises the route wiring on top of this).
    """
    user = _create_user(session)
    pipeline = _create_pipeline(session, user)
    collection = _create_collection(session, user)
    run = _create_run(session, user, pipeline, collection)

    response = TraceService(session).get_run_trace(run.id, user.id)

    assert isinstance(response, PipelineTraceResponse)
    assert response.run.id == run.id


def test_get_pipeline_run_trace_missing(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_pipeline_run_trace(uuid4(), current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_get_pipeline_run_trace_success(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    run = _create_run(session, user, pipeline, collection)

    response = traces_routes.get_pipeline_run_trace(run.id, current_user=user, session=session)

    assert response.run.id == run.id


def test_get_document_trace_missing_document(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_document_trace(uuid4(), current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_get_document_trace_success(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    run = _create_run(session, user, pipeline, collection)

    document = models.Document(
        user_id=user.id,
        collection_id=collection.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=0,
        num_tokens=0,
        chunk_size=1,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed-model",
        ingestion_run_id=run.id,
    )
    session.add(document)
    session.commit()

    response = traces_routes.get_document_trace(document.id, current_user=user, session=session)

    assert response.run.id == run.id


def test_get_document_trace_missing_run(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    other_user = _create_user(session)
    other_collection = _create_collection(session, other_user)
    pipeline = _create_pipeline(session, other_user)
    run = _create_run(session, other_user, pipeline, other_collection)
    document = models.Document(
        user_id=user.id,
        collection_id=collection.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=0,
        num_tokens=0,
        chunk_size=1,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed-model",
        ingestion_run_id=run.id,
    )
    session.add(document)
    session.commit()

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_document_trace(document.id, current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_get_document_trace_missing_ingestion_run(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    document = models.Document(
        user_id=user.id,
        collection_id=collection.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=0,
        num_tokens=0,
        chunk_size=1,
        chunk_overlap=0,
        chunk_strategy=models.ChunkStrategy.TOKEN,
        embedding_model="embed-model",
    )
    session.add(document)
    session.commit()

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_document_trace(document.id, current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_get_query_event_trace_missing_event(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_query_event_trace(uuid4(), current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_get_query_event_trace_success(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    run = _create_run(session, user, pipeline, collection)

    event = models.QueryEvent(
        user_id=user.id,
        collection_id=collection.id,
        query_text="query",
        top_k=3,
        model="embed-model",
        context_tokens=0,
        latency_ms=0.0,
        response_payload={},
        pipeline_run_id=run.id,
    )
    session.add(event)
    session.commit()

    response = traces_routes.get_query_event_trace(event.id, current_user=user, session=session)

    assert response.run.id == run.id


def test_get_query_event_trace_missing_run(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    other_user = _create_user(session)
    other_collection = _create_collection(session, other_user)
    pipeline = _create_pipeline(session, other_user)
    run = _create_run(session, other_user, pipeline, other_collection)
    event = models.QueryEvent(
        user_id=user.id,
        collection_id=collection.id,
        query_text="query",
        top_k=3,
        model="embed-model",
        context_tokens=0,
        latency_ms=0.0,
        response_payload={},
        pipeline_run_id=run.id,
    )
    session.add(event)
    session.commit()

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_query_event_trace(event.id, current_user=user, session=session)

    assert excinfo.value.status_code == 404


def test_get_query_event_trace_missing_pipeline_run_id(session: Session) -> None:
    user = _create_user(session)
    collection = _create_collection(session, user)
    event = models.QueryEvent(
        user_id=user.id,
        collection_id=collection.id,
        query_text="query",
        top_k=3,
        model="embed-model",
        context_tokens=0,
        latency_ms=0.0,
        response_payload={},
        pipeline_run_id=None,
    )
    session.add(event)
    session.commit()

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_query_event_trace(event.id, current_user=user, session=session)

    assert excinfo.value.status_code == 404


def _create_document_with_run(
    session: Session,
    user: models.User,
    collection: models.Collection,
    run: models.PipelineRun,
) -> models.Document:
    document = models.Document(
        collection_id=collection.id,
        user_id=user.id,
        name="handbook.txt",
        content_type="text/plain",
        embedding_model="embed-model",
        ingestion_run_id=run.id,
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def _create_query_event(
    session: Session,
    user: models.User,
    collection: models.Collection,
    run: models.PipelineRun,
) -> models.QueryEvent:
    event = models.QueryEvent(
        user_id=user.id,
        collection_id=collection.id,
        query_text="query",
        top_k=3,
        model="embed-model",
        context_tokens=0,
        latency_ms=0.0,
        response_payload={},
        pipeline_run_id=run.id,
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def _add_item_trace(
    session: Session,
    run: models.PipelineRun,
    item_ids: list[str],
    *,
    node_id: str = "ranker",
) -> None:
    """Attach one complete item list to a run for focused-context tests."""
    session.add(
        models.PipelineNodeRun(
            run_id=run.id,
            node_id=node_id,
            node_type="retriever.vector",
            node_name="Retriever",
            sequence_index=0,
            status=models.PipelineRunStatus.COMPLETED,
            summary={
                "inputs": [],
                "outputs": [
                    {
                        "label": "Match items",
                        "kind": "items",
                        "value": {
                            "kind": "matches",
                            "items": [{"id": item_id, "score": 1.0} for item_id in item_ids],
                        },
                    }
                ],
            },
        )
    )
    session.commit()


def test_end_to_end_trace_joins_retrieval_with_chunk_origin(session: Session) -> None:
    """Tracing a retrieved chunk returns the retrieval run AND the ingestion
    run of the document the chunk came from (chunk ids are `{document_id}:{i}`)."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    ingestion_run = _create_run(session, user, pipeline, collection)
    retrieval_run = _create_run(session, user, pipeline, collection)
    document = _create_document_with_run(session, user, collection, ingestion_run)
    event = _create_query_event(session, user, collection, retrieval_run)

    response = TraceService(session).get_query_event_end_to_end_trace(
        event.id, user.id, chunk_id=f"{document.id}:0"
    )

    assert response.retrieval.run.id == retrieval_run.id
    assert response.origin is not None
    assert response.origin.document_id == document.id
    assert response.origin.document_name == "handbook.txt"
    assert response.origin.chunk_id == f"{document.id}:0"
    assert response.origin.trace.run.id == ingestion_run.id


def test_end_to_end_trace_degrades_gracefully_without_origin(session: Session) -> None:
    """A malformed chunk id, a foreign document, or no chunk id at all still
    yields the retrieval trace with origin=None -- never a 404."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    retrieval_run = _create_run(session, user, pipeline, collection)
    event = _create_query_event(session, user, collection, retrieval_run)

    service = TraceService(session)
    assert service.get_query_event_end_to_end_trace(event.id, user.id).origin is None
    assert (
        service.get_query_event_end_to_end_trace(event.id, user.id, chunk_id="not-a-uuid:0").origin
        is None
    )
    assert (
        service.get_query_event_end_to_end_trace(event.id, user.id, chunk_id=f"{uuid4()}:0").origin
        is None
    )

    # A document owned by someone else must not leak through the origin side.
    other_user = _create_user(session)
    other_collection = _create_collection(session, other_user)
    other_pipeline = _create_pipeline(session, other_user)
    other_run = _create_run(session, other_user, other_pipeline, other_collection)
    foreign_document = _create_document_with_run(session, other_user, other_collection, other_run)
    assert (
        service.get_query_event_end_to_end_trace(
            event.id, user.id, chunk_id=f"{foreign_document.id}:0"
        ).origin
        is None
    )


def test_end_to_end_trace_resolves_focused_item_text(session: Session) -> None:
    """Tracing a chunk returns its stored text and document context so the
    focused trace view can show what result is being followed, not just an id."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    ingestion_run = _create_run(session, user, pipeline, collection)
    retrieval_run = _create_run(session, user, pipeline, collection)
    document = _create_document_with_run(session, user, collection, ingestion_run)
    document.num_chunks = 3
    session.add(document)
    session.add(
        models.DocumentChunkRecord(
            document_id=document.id,
            collection_id=collection.id,
            chunk_index=1,
            text="Reciprocal rank fusion combines ranked lists.",
            embedding=[],
            chunk_metadata={},
            embedding_model="embed-model",
        )
    )
    session.commit()
    event = _create_query_event(session, user, collection, retrieval_run)

    response = TraceService(session).get_query_event_end_to_end_trace(
        event.id, user.id, chunk_id=f"{document.id}:1"
    )

    focused = response.focused_item
    assert focused is not None
    assert focused.status == "resolved"
    assert focused.text == "Reciprocal rank fusion combines ranked lists."
    assert focused.document_id == document.id
    assert focused.filename == "handbook.txt"
    assert focused.chunk_index == 1
    assert focused.chunk_count == 3


def test_end_to_end_trace_resolves_deduplicated_neighbor_context(session: Session) -> None:
    """Focused traces resolve the focused chunk and its ±2 recorded-list
    neighbors in one user-scoped batch without leaking foreign chunk text."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    ingestion_run = _create_run(session, user, pipeline, collection)
    retrieval_run = _create_run(session, user, pipeline, collection)
    document = _create_document_with_run(session, user, collection, ingestion_run)
    document.num_chunks = 7
    chunks = [
        models.DocumentChunkRecord(
            document_id=document.id,
            collection_id=collection.id,
            chunk_index=index,
            text=f"Chunk {index}",
            embedding=[],
            chunk_metadata={},
            embedding_model="embed-model",
        )
        for index in range(7)
    ]
    session.add_all(chunks)

    other_user = _create_user(session)
    other_collection = _create_collection(session, other_user)
    other_pipeline = _create_pipeline(session, other_user)
    other_run = _create_run(session, other_user, other_pipeline, other_collection)
    foreign_document = _create_document_with_run(session, other_user, other_collection, other_run)
    foreign_chunk = models.DocumentChunkRecord(
        document_id=foreign_document.id,
        collection_id=other_collection.id,
        chunk_index=0,
        text="Foreign text",
        embedding=[],
        chunk_metadata={},
        embedding_model="embed-model",
    )
    session.add(foreign_chunk)
    session.commit()

    ids = [f"{document.id}:{index}" for index in range(7)]
    foreign_id = f"{foreign_document.id}:0"
    _add_item_trace(session, retrieval_run, ids[1:6], node_id="semantic")
    _add_item_trace(
        session,
        retrieval_run,
        [ids[0], foreign_id, ids[3], ids[6]],
        node_id="fusion",
    )
    event = _create_query_event(session, user, collection, retrieval_run)

    response = TraceService(session).get_query_event_end_to_end_trace(
        event.id, user.id, chunk_id=ids[3]
    )

    assert response.focused_item is not None
    assert response.focused_item.text == "Chunk 3"
    assert [item.id for item in response.context_items] == [
        ids[1],
        ids[2],
        ids[3],
        ids[4],
        ids[5],
        ids[0],
        foreign_id,
        ids[6],
    ]
    assert [item.text for item in response.context_items[:-3]] == [
        "Chunk 1",
        "Chunk 2",
        "Chunk 3",
        "Chunk 4",
        "Chunk 5",
    ]
    foreign = next(item for item in response.context_items if item.id == foreign_id)
    assert foreign.status == "missing"
    assert foreign.text is None


def test_end_to_end_trace_focused_item_missing_cases(session: Session) -> None:
    """A malformed, deleted, or foreign chunk id yields status="missing" with
    the id echoed back -- never a failure of the retrieval trace itself."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    retrieval_run = _create_run(session, user, pipeline, collection)
    event = _create_query_event(session, user, collection, retrieval_run)
    service = TraceService(session)

    # No chunk requested: no focused item at all.
    assert service.get_query_event_end_to_end_trace(event.id, user.id).focused_item is None

    for chunk_id in ("not-a-uuid:0", f"{uuid4()}:0", f"{uuid4()}:not-an-int"):
        focused = service.get_query_event_end_to_end_trace(
            event.id, user.id, chunk_id=chunk_id
        ).focused_item
        assert focused is not None
        assert focused.status == "missing"
        assert focused.id == chunk_id
        assert focused.text is None

    # A chunk owned by someone else must not leak text through the lookup.
    other_user = _create_user(session)
    other_collection = _create_collection(session, other_user)
    other_pipeline = _create_pipeline(session, other_user)
    other_run = _create_run(session, other_user, other_pipeline, other_collection)
    foreign_document = _create_document_with_run(session, other_user, other_collection, other_run)
    session.add(
        models.DocumentChunkRecord(
            document_id=foreign_document.id,
            collection_id=other_collection.id,
            chunk_index=0,
            text="secret",
            embedding=[],
            chunk_metadata={},
            embedding_model="embed-model",
        )
    )
    session.commit()
    focused = service.get_query_event_end_to_end_trace(
        event.id, user.id, chunk_id=f"{foreign_document.id}:0"
    ).focused_item
    assert focused is not None
    assert focused.status == "missing"
    assert focused.text is None


def test_document_focused_trace_resolves_chunk_text(session: Session) -> None:
    """Tracing a chunk from the Files page (ingestion-only) resolves the same
    focused-item payload as the retrieval path, so the focus header can show
    the chunk's text instead of claiming it no longer exists."""
    user = _create_user(session)
    collection = _create_collection(session, user)
    pipeline = _create_pipeline(session, user)
    run = _create_run(session, user, pipeline, collection)
    document = _create_document_with_run(session, user, collection, run)
    document.num_chunks = 2
    session.add(document)
    session.add(
        models.DocumentChunkRecord(
            document_id=document.id,
            collection_id=collection.id,
            chunk_index=1,
            text="Ingested chunk text.",
            embedding=[],
            chunk_metadata={},
            embedding_model="embed-model",
        )
    )
    session.commit()

    response = traces_routes.get_document_focused_trace(
        document.id, chunk_id=f"{document.id}:1", current_user=user, session=session
    )

    assert response.trace.run.id == run.id
    focused = response.focused_item
    assert focused is not None
    assert focused.status == "resolved"
    assert focused.text == "Ingested chunk text."
    assert focused.chunk_index == 1
    assert focused.chunk_count == 2

    # Without a chunk the endpoint degrades to the plain trace payload.
    bare = traces_routes.get_document_focused_trace(
        document.id, chunk_id=None, current_user=user, session=session
    )
    assert bare.focused_item is None

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_document_focused_trace(
            uuid4(), chunk_id=None, current_user=user, session=session
        )
    assert excinfo.value.status_code == 404


def test_end_to_end_trace_route_translates_missing_event(session: Session) -> None:
    user = _create_user(session)

    with pytest.raises(HTTPException) as excinfo:
        traces_routes.get_query_event_end_to_end_trace(
            uuid4(), chunk_id=None, current_user=user, session=session
        )

    assert excinfo.value.status_code == 404
