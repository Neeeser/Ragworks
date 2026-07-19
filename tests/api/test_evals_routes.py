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
