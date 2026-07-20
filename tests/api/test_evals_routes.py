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
