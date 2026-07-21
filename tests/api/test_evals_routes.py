"""HTTP contract for the evals routes: auth, validation, shape, isolation."""

from __future__ import annotations

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models

CORPUS = '{"_id": "d1", "title": "T", "text": "alpha"}\n'
QUERIES = '{"_id": "q1", "text": "what is alpha"}\n'
QRELS = "q1\td1\t1\n"

UPLOAD_BODY = {
    "name": "Golden",
    "corpus": CORPUS,
    "queries": QUERIES,
    "qrels": QRELS,
}


def test_evals_routes_require_auth(unauthed_client: TestClient) -> None:
    """Every evals surface 401s without a token."""
    for path in ("/api/evals/datasets", "/api/evals/runs", "/api/evals/benchmarks"):
        assert unauthed_client.get(path).status_code == 401


def test_benchmark_and_metric_catalogs(client: TestClient) -> None:
    """The catalogs return registry-backed entries with tooltip text."""
    benchmarks = client.get("/api/evals/benchmarks").json()
    assert any(entry["key"] == "scifact" for entry in benchmarks)
    metrics = client.get("/api/evals/metrics").json()
    names = {metric["name"] for metric in metrics}
    assert {"recall", "precision", "hit", "mrr", "ndcg", "map"} <= names
    assert all(metric["description"] for metric in metrics)


def test_upload_list_get_delete_dataset(client: TestClient) -> None:
    """A dataset uploads, lists, reads, and deletes over the wire."""
    created = client.post("/api/evals/datasets/upload", json=UPLOAD_BODY)
    assert created.status_code == 201
    dataset = created.json()
    assert dataset["status"] == "ready"
    assert dataset["num_queries"] == 1

    listed = client.get("/api/evals/datasets").json()
    assert [entry["id"] for entry in listed] == [dataset["id"]]

    fetched = client.get(f"/api/evals/datasets/{dataset['id']}")
    assert fetched.status_code == 200

    deleted = client.delete(f"/api/evals/datasets/{dataset['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/evals/datasets/{dataset['id']}").status_code == 404


def test_upload_rejects_malformed_dataset(client: TestClient) -> None:
    """A corpus that is not JSONL is a 400, and a missing field is a 422."""
    bad_corpus = client.post(
        "/api/evals/datasets/upload", json={**UPLOAD_BODY, "corpus": "not json"}
    )
    assert bad_corpus.status_code == 400
    missing_field = client.post("/api/evals/datasets/upload", json={"name": "x"})
    assert missing_field.status_code == 422


def test_create_run_validates_references(client: TestClient) -> None:
    """A run against a missing dataset 404s; malformed config 422s."""
    body = {
        "dataset_id": str(uuid4()),
        "ingestion_pipeline_id": str(uuid4()),
        "retrieval_pipeline_id": str(uuid4()),
        "config": {"num_queries": 5, "distractor_pool_size": 10},
    }
    assert client.post("/api/evals/runs", json=body).status_code == 404
    assert (
        client.post("/api/evals/runs", json={**body, "config": {"num_queries": 0}}).status_code
        == 422
    )


def test_run_items_response_names_documents(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """Items come back with typed detail plus a gold/retrieved title map."""
    dataset = models.EvalDataset(
        user_id=auth_user.id, name="Golden", source="custom_upload", status="ready"
    )
    ingestion = models.Pipeline(
        user_id=auth_user.id, name="Ing", kind=models.PipelineKind.INGESTION
    )
    retrieval = models.Pipeline(
        user_id=auth_user.id, name="Ret", kind=models.PipelineKind.RETRIEVAL
    )
    session.add_all([dataset, ingestion, retrieval])
    session.commit()
    session.add(
        models.EvalDatasetDocument(
            dataset_id=dataset.id, external_doc_id="d1", title="Alpha doc", text="alpha"
        )
    )
    run = models.EvalRun(
        user_id=auth_user.id,
        dataset_id=dataset.id,
        ingestion_pipeline_id=ingestion.id,
        retrieval_pipeline_id=retrieval.id,
        status="completed",
    )
    session.add(run)
    session.commit()
    session.add(
        models.EvalRunItem(
            run_id=run.id,
            query_external_id="q1",
            query_text="what is alpha",
            result_count=1,
            gold_doc_ids=["d1"],
            retrieved=[{"chunk_id": "c1:0", "document_id": "d1", "score": 0.9}],
            metrics={"recall@10": 1.0},
            per_node_funnel=[{"node_id": "ingestion", "document_ids": ["d1"]}],
        )
    )
    session.commit()

    payload = client.get(f"/api/evals/runs/{run.id}/items").json()
    assert payload["document_titles"] == {"d1": "Alpha doc"}
    item = payload["items"][0]
    assert item["retrieved"] == [{"chunk_id": "c1:0", "document_id": "d1", "score": 0.9}]
    assert item["retrieved_document_ids"] == ["d1"]
    assert item["per_node_funnel"] == [{"node_id": "ingestion", "document_ids": ["d1"]}]


def test_cross_user_run_isolation(
    client: TestClient, session: Session
) -> None:
    """Another user's run reads as 404, not 403 or 200."""
    other = models.User(email="other@example.com", full_name="Other", hashed_password="x")
    session.add(other)
    session.commit()
    session.refresh(other)
    dataset = models.EvalDataset(
        user_id=other.id, name="Theirs", source="custom_upload", status="ready"
    )
    ingestion = models.Pipeline(
        user_id=other.id, name="Ing", kind=models.PipelineKind.INGESTION
    )
    retrieval = models.Pipeline(
        user_id=other.id, name="Ret", kind=models.PipelineKind.RETRIEVAL
    )
    session.add(dataset)
    session.add(ingestion)
    session.add(retrieval)
    session.commit()
    run = models.EvalRun(
        user_id=other.id,
        dataset_id=dataset.id,
        ingestion_pipeline_id=ingestion.id,
        retrieval_pipeline_id=retrieval.id,
        status="completed",
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    assert client.get(f"/api/evals/runs/{run.id}").status_code == 404
    assert client.get(f"/api/evals/datasets/{dataset.id}").status_code == 404
    assert client.delete(f"/api/evals/runs/{run.id}").status_code == 404


def _seed_eval_collection(
    session: Session, user: models.User, dataset_id, names_ready: dict[str, bool]
) -> models.Collection:
    """Create an eval collection with one document row per given file name."""
    collection = models.Collection(
        user_id=user.id,
        name="Eval: seeded",
        system_purpose="eval",
        extra_metadata={"eval_dataset_id": str(dataset_id)},
    )
    session.add(collection)
    session.commit()
    for name, ready in names_ready.items():
        session.add(
            models.Document(
                user_id=user.id,
                collection_id=collection.id,
                name=name,
                content_type="text/plain",
                embedding_model="stub-embedder",
                status=models.DocumentStatus.READY if ready else models.DocumentStatus.FAILED,
                error_message=None if ready else "parse error",
                num_chunks=2 if ready else 0,
            )
        )
    session.commit()
    return collection


def test_collection_documents_page_search_and_isolation(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    """The document browser pages, searches by id/title, and 404s on foreign ids."""
    corpus = (
        '{"_id": "d1", "title": "Alpha doc", "text": "alpha"}\n'
        '{"_id": "d2", "title": "Beta doc", "text": "beta"}\n'
        '{"_id": "d3", "title": "Gamma doc", "text": "gamma"}\n'
    )
    qrels = "q1\td1\t1\n"
    dataset = client.post(
        "/api/evals/datasets/upload", json={**UPLOAD_BODY, "corpus": corpus, "qrels": qrels}
    ).json()
    collection = _seed_eval_collection(
        session, auth_user, dataset["id"], {"d1.txt": True, "d2.txt": True, "d3.txt": False}
    )

    page = client.get(f"/api/evals/collections/{collection.id}/documents?limit=2").json()
    assert page["total"] == 3
    assert [item["external_doc_id"] for item in page["items"]] == ["d1", "d2"]
    assert page["items"][0]["title"] == "Alpha doc"
    assert page["items"][0]["status"] == "ready"

    rest = client.get(f"/api/evals/collections/{collection.id}/documents?offset=2&limit=2").json()
    assert [item["external_doc_id"] for item in rest["items"]] == ["d3"]
    assert rest["items"][0]["status"] == "failed"
    assert rest["items"][0]["error_message"] == "parse error"

    by_title = client.get(
        f"/api/evals/collections/{collection.id}/documents?search=beta"
    ).json()
    assert page["total"] == 3
    assert [item["external_doc_id"] for item in by_title["items"]] == ["d2"]

    assert (
        client.get(f"/api/evals/collections/{uuid4()}/documents").status_code == 404
    )


def test_dataset_document_text(client: TestClient) -> None:
    """A corpus document's stored text reads back; unknown ids 404."""
    dataset = client.post("/api/evals/datasets/upload", json=UPLOAD_BODY).json()
    doc = client.get(f"/api/evals/datasets/{dataset['id']}/documents/d1")
    assert doc.status_code == 200
    assert doc.json() == {"external_doc_id": "d1", "title": "T", "text": "alpha"}
    assert (
        client.get(f"/api/evals/datasets/{dataset['id']}/documents/missing").status_code
        == 404
    )


# --- synthetic generation -----------------------------------------------------


def _generation_inputs(
    session: Session, auth_user: models.User
) -> tuple[models.Collection, models.ProviderConnection]:
    """A ready collection (one chunked document) plus a chat connection."""
    collection = models.Collection(name="Papers", user_id=auth_user.id)
    session.add(collection)
    session.commit()
    session.refresh(collection)
    document = models.Document(
        collection_id=collection.id,
        user_id=auth_user.id,
        name="doc.txt",
        content_type="text/plain",
        status=models.DocumentStatus.READY,
        num_chunks=1,
        embedding_model="stub-embedder",
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    session.add(
        models.DocumentChunkRecord(
            document_id=document.id,
            collection_id=collection.id,
            chunk_index=0,
            text="The alpha subsystem retries twice before failing over.",
            embedding=[],
            embedding_model="stub-embedder",
        )
    )
    connection = models.ProviderConnection(
        user_id=auth_user.id,
        provider_type="openrouter",
        label="OpenRouter",
        config={"api_key": "sk-test"},
    )
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return collection, connection


def _generate_body(collection_id: str, connection_id: str) -> dict[str, object]:
    return {
        "name": "Synthetic set",
        "collection_id": collection_id,
        "connection_id": connection_id,
        "model_name": "test/model",
        "num_questions": 5,
    }


def test_generate_dataset_records_generating_row(
    client: TestClient, session: Session, auth_user: models.User, monkeypatch
) -> None:
    """A valid generate request 202s with a generating synthetic dataset."""
    collection, connection = _generation_inputs(session, auth_user)
    monkeypatch.setattr("app.api.routes.evals.run_dataset_generation", lambda _id: None)
    response = client.post(
        "/api/evals/datasets/generate",
        json=_generate_body(str(collection.id), str(connection.id)),
    )
    assert response.status_code == 202
    dataset = response.json()
    assert dataset["status"] == "generating"
    assert dataset["source"] == "synthetic"
    assert dataset["progress_total"] == 5
    assert dataset["generation_config"]["model_name"] == "test/model"


def test_generate_dataset_validation_failures(
    client: TestClient, session: Session, auth_user: models.User, monkeypatch
) -> None:
    """Unknown collection 404s, empty collection 400s, bad count 422s."""
    collection, connection = _generation_inputs(session, auth_user)
    monkeypatch.setattr("app.api.routes.evals.run_dataset_generation", lambda _id: None)
    body = _generate_body(str(uuid4()), str(connection.id))
    assert client.post("/api/evals/datasets/generate", json=body).status_code == 404

    empty = models.Collection(name="Empty", user_id=auth_user.id)
    session.add(empty)
    session.commit()
    session.refresh(empty)
    body = _generate_body(str(empty.id), str(connection.id))
    assert client.post("/api/evals/datasets/generate", json=body).status_code == 400

    body = {**_generate_body(str(collection.id), str(connection.id)), "num_questions": 0}
    assert client.post("/api/evals/datasets/generate", json=body).status_code == 422


def test_dataset_query_review_flow(client: TestClient) -> None:
    """Queries list with gold titles, edit in place, and delete with qrels."""
    corpus = (
        '{"_id": "d1", "title": "Alpha doc", "text": "alpha"}\n'
        '{"_id": "d2", "title": "Beta doc", "text": "beta"}\n'
    )
    queries = (
        '{"_id": "q1", "text": "what is alpha"}\n'
        '{"_id": "q2", "text": "what is beta"}\n'
    )
    qrels = "q1\td1\t1\nq2\td2\t1\n"
    dataset = client.post(
        "/api/evals/datasets/upload",
        json={**UPLOAD_BODY, "corpus": corpus, "queries": queries, "qrels": qrels},
    ).json()

    page = client.get(f"/api/evals/datasets/{dataset['id']}/queries").json()
    assert page["total"] == 2
    assert [item["external_query_id"] for item in page["items"]] == ["q1", "q2"]
    assert page["items"][0]["gold"] == [
        {"external_doc_id": "d1", "title": "Alpha doc"}
    ]
    assert page["items"][0]["question_type"] is None

    first_id = page["items"][0]["id"]
    edited = client.patch(
        f"/api/evals/datasets/{dataset['id']}/queries/{first_id}",
        json={"text": "what exactly is alpha?"},
    )
    assert edited.status_code == 200
    assert edited.json()["text"] == "what exactly is alpha?"
    assert edited.json()["gold"] == [{"external_doc_id": "d1", "title": "Alpha doc"}]

    deleted = client.delete(f"/api/evals/datasets/{dataset['id']}/queries/{first_id}")
    assert deleted.status_code == 204
    after = client.get(f"/api/evals/datasets/{dataset['id']}/queries").json()
    assert after["total"] == 1
    refreshed = client.get(f"/api/evals/datasets/{dataset['id']}").json()
    assert refreshed["num_queries"] == 1

    last_id = after["items"][0]["id"]
    blocked = client.delete(f"/api/evals/datasets/{dataset['id']}/queries/{last_id}")
    assert blocked.status_code == 400


def test_dataset_queries_cross_user_isolation(
    client: TestClient, session: Session
) -> None:
    """Another user's dataset queries are invisible on every verb."""
    other = models.User(email="o@example.com", full_name="O", hashed_password="x")
    session.add(other)
    session.commit()
    session.refresh(other)
    dataset = models.EvalDataset(
        user_id=other.id, name="Theirs", source="custom_upload", status="ready"
    )
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    query = models.EvalDatasetQuery(
        dataset_id=dataset.id, external_query_id="q1", text="theirs"
    )
    session.add(query)
    session.commit()
    session.refresh(query)

    base = f"/api/evals/datasets/{dataset.id}/queries"
    assert client.get(base).status_code == 404
    assert client.patch(f"{base}/{query.id}", json={"text": "mine"}).status_code == 404
    assert client.delete(f"{base}/{query.id}").status_code == 404
