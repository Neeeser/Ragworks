"""HTTP contract for the `/api/prompts` library routes."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _create(client: TestClient, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "Greeting",
        "context": "chat.base",
        "body": "Hello {{user.full_name}}",
    }
    payload.update(overrides)
    response = client.post("/api/prompts", json=payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_create_list_and_context_filter(client: TestClient) -> None:
    _create(client)
    _create(client, name="Summarize", context="node.transform", body="Sum: {{text}}")
    assert len(client.get("/api/prompts").json()) == 2
    narrowed = client.get("/api/prompts", params={"context": "node.transform"}).json()
    assert [prompt["name"] for prompt in narrowed] == ["Summarize"]


def test_create_rejects_unknown_variable_with_400(client: TestClient) -> None:
    response = client.post(
        "/api/prompts",
        json={"name": "Bad", "context": "chat.base", "body": "{{nope}}"},
    )
    assert response.status_code == 400
    assert "nope" in response.json()["detail"]


def test_versions_and_detail_follow_latest(client: TestClient) -> None:
    prompt = _create(client)
    response = client.post(
        f"/api/prompts/{prompt['id']}/versions",
        json={"body": "Hi {{user.email}}", "label": "email instead"},
    )
    assert response.status_code == 201
    assert response.json()["version"] == 2
    detail = client.get(f"/api/prompts/{prompt['id']}").json()
    assert detail["current_version"] == 2
    assert detail["body"] == "Hi {{user.email}}"
    versions = client.get(f"/api/prompts/{prompt['id']}/versions").json()
    assert [entry["version"] for entry in versions] == [2, 1]


def test_fork_creates_new_entity(client: TestClient) -> None:
    prompt = _create(client)
    response = client.post(
        f"/api/prompts/{prompt['id']}/fork",
        json={"name": "Greeting fork"},
    )
    assert response.status_code == 201
    fork = response.json()
    assert fork["id"] != prompt["id"]
    assert fork["current_version"] == 1


def test_catalogs_list_every_context(client: TestClient) -> None:
    catalogs = client.get("/api/prompts/catalogs").json()
    contexts = {entry["context"] for entry in catalogs}
    assert contexts == {
        "chat.base",
        "chat.tool",
        "node.transform",
        "node.rerank",
        "node.generate",
    }


def test_render_reports_unknown_variables_without_failing(client: TestClient) -> None:
    response = client.post(
        "/api/prompts/render",
        json={"body": "Hello {{user.full_name}} {{mystery}}", "context": "chat.base"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "Avery Lee" in data["rendered"]
    assert data["unknown_variables"] == ["mystery"]
    assert "{{mystery}}" in data["rendered"]


def test_requires_auth(unauthed_client: TestClient) -> None:
    assert unauthed_client.get("/api/prompts").status_code == 401
