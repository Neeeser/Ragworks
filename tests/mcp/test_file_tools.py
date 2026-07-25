"""The file tools, driven over MCP end to end.

Uploads run through the real `FileSystemService`, so what an agent adds is a
file the Files page shows with a pending ingestion record — the assertions read
that back rather than trusting the tool's own message. Ingestion itself is
stubbed at the queue boundary (the suite never hits a live embedder), which is
also what pins the "eligible uploads are queued" contract.
"""

from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.db.repositories import DocumentRepository, FileNodeRepository
from app.mcp.tools import files_write
from app.schemas.enums import ApiKeyCapability, DocumentStatus
from tests.mcp.conftest import issue_key, rpc


@pytest.fixture(name="queued_ingestions", autouse=True)
def queued_ingestions_fixture(monkeypatch: pytest.MonkeyPatch) -> list[object]:
    """Capture queued ingestions instead of running them inline.

    Patched at the boundary the tool actually calls; the captured list is what
    proves an eligible upload was queued.
    """
    queued: list[object] = []
    monkeypatch.setattr(
        files_write, "enqueue_document_ingestion", lambda document_id: queued.append(document_id)
    )
    return queued


def _call(
    client: TestClient,
    collection: models.Collection,
    secret: str,
    name: str,
    arguments: dict[str, object],
) -> dict[str, object]:
    body = rpc(
        client, collection.id, secret, "tools/call", {"name": name, "arguments": arguments}
    )
    result = body.get("result")
    assert isinstance(result, dict), body
    return result


@pytest.fixture(name="write_secret")
def write_secret_fixture(
    session: Session, mcp_user: models.User, mcp_collection: models.Collection
) -> str:
    """A key granting both file capabilities on the test collection."""
    return issue_key(
        session,
        mcp_user,
        capabilities=[ApiKeyCapability.FILES_READ, ApiKeyCapability.FILES_WRITE],
        collection_ids=[mcp_collection.id],
    )


def test_upload_stores_the_file_creates_folders_and_queues_ingestion(
    mcp_client: TestClient,
    session: Session,
    mcp_collection: models.Collection,
    write_secret: str,
    queued_ingestions: list[object],
) -> None:
    result = _call(
        mcp_client,
        mcp_collection,
        write_secret,
        "upload_file",
        {"path": "notes/day-one.md", "content": "# Day one\nAurora over the ridge.\n"},
    )

    assert result["isError"] is False
    structured = result["structuredContent"]
    assert isinstance(structured, dict)
    assert structured["path"] == "/notes/day-one.md"
    assert structured["ingestion_queued"] is True
    with Session(session.get_bind()) as fresh:
        nodes = FileNodeRepository(fresh).list_for_collection(mcp_collection.id)
        names = sorted(node.name for node in nodes)
        assert names == ["day-one.md", "notes"]
        document = DocumentRepository(fresh).get_for_file(
            next(node.id for node in nodes if node.name == "day-one.md")
        )
        assert document is not None
        assert document.status == DocumentStatus.PENDING
    assert len(queued_ingestions) == 1


def test_base64_upload_round_trips_its_bytes(
    mcp_client: TestClient,
    session: Session,
    mcp_collection: models.Collection,
    write_secret: str,
) -> None:
    payload = b"Ridge survey, 1983.\n"

    _call(
        mcp_client,
        mcp_collection,
        write_secret,
        "upload_file",
        {
            "path": "survey.txt",
            "content": base64.b64encode(payload).decode(),
            "encoding": "base64",
        },
    )

    read = _call(
        mcp_client, mcp_collection, write_secret, "read_file", {"path": "survey.txt"}
    )
    structured = read["structuredContent"]
    assert isinstance(structured, dict)
    assert structured["content"] == payload.decode()


def test_invalid_base64_is_a_tool_error_not_a_stored_file(
    mcp_client: TestClient,
    session: Session,
    mcp_collection: models.Collection,
    write_secret: str,
) -> None:
    result = _call(
        mcp_client,
        mcp_collection,
        write_secret,
        "upload_file",
        {"path": "broken.bin", "content": "not!base64!", "encoding": "base64"},
    )

    assert result["isError"] is True
    with Session(session.get_bind()) as fresh:
        assert FileNodeRepository(fresh).list_for_collection(mcp_collection.id) == []


def test_unknown_argument_is_a_tool_error_the_model_can_correct(
    mcp_client: TestClient, mcp_collection: models.Collection, write_secret: str
) -> None:
    """Per spec, argument validation failures are tool errors, not protocol errors."""
    result = _call(
        mcp_client,
        mcp_collection,
        write_secret,
        "read_file",
        {"pathh": "survey.txt"},
    )

    assert result["isError"] is True
    content = result["content"]
    assert isinstance(content, list)
    assert "Invalid arguments" in content[0]["text"]


def test_list_files_shows_uploaded_entries_and_read_returns_content(
    mcp_client: TestClient, mcp_collection: models.Collection, write_secret: str
) -> None:
    _call(
        mcp_client,
        mcp_collection,
        write_secret,
        "upload_file",
        {"path": "notes/day-two.md", "content": "Tidepool consensus reached.\n"},
    )

    listing = _call(mcp_client, mcp_collection, write_secret, "list_files", {"path": "/"})
    structured = listing["structuredContent"]
    assert isinstance(structured, dict)
    assert [entry["name"] for entry in structured["entries"]] == ["notes"]

    nested = _call(
        mcp_client, mcp_collection, write_secret, "list_files", {"path": "notes"}
    )
    nested_structured = nested["structuredContent"]
    assert isinstance(nested_structured, dict)
    assert [entry["name"] for entry in nested_structured["entries"]] == ["day-two.md"]

    # Status renders as its value, not a Python enum repr, in both channels.
    assert nested_structured["entries"][0]["ingestion_status"] == "pending"
    nested_text = nested["content"]
    assert isinstance(nested_text, list)
    assert "ingestion: pending" in nested_text[0]["text"]

    read = _call(
        mcp_client, mcp_collection, write_secret, "read_file", {"path": "notes/day-two.md"}
    )
    read_content = read["content"]
    assert isinstance(read_content, list)
    assert read_content[0]["text"] == "Tidepool consensus reached.\n"


def test_missing_path_is_a_tool_error(
    mcp_client: TestClient, mcp_collection: models.Collection, write_secret: str
) -> None:
    result = _call(
        mcp_client, mcp_collection, write_secret, "read_file", {"path": "nope.md"}
    )

    assert result["isError"] is True


def test_delete_removes_the_file_from_the_tree(
    mcp_client: TestClient,
    session: Session,
    mcp_collection: models.Collection,
    write_secret: str,
) -> None:
    _call(
        mcp_client,
        mcp_collection,
        write_secret,
        "upload_file",
        {"path": "transient.md", "content": "temporary\n"},
    )

    result = _call(
        mcp_client, mcp_collection, write_secret, "delete_file", {"path": "transient.md"}
    )

    assert result["isError"] is False
    with Session(session.get_bind()) as fresh:
        assert FileNodeRepository(fresh).list_for_collection(mcp_collection.id) == []


def test_create_folder_requires_an_existing_parent(
    mcp_client: TestClient, mcp_collection: models.Collection, write_secret: str
) -> None:
    missing_parent = _call(
        mcp_client, mcp_collection, write_secret, "create_folder", {"path": "a/b"}
    )
    assert missing_parent["isError"] is True

    created = _call(
        mcp_client, mcp_collection, write_secret, "create_folder", {"path": "a"}
    )
    assert created["isError"] is False
    nested = _call(
        mcp_client, mcp_collection, write_secret, "create_folder", {"path": "a/b"}
    )
    assert nested["isError"] is False


def test_search_files_matches_names_only(
    mcp_client: TestClient, mcp_collection: models.Collection, write_secret: str
) -> None:
    for path in ("aurora-log.md", "ridge-notes.md"):
        _call(
            mcp_client,
            mcp_collection,
            write_secret,
            "upload_file",
            {"path": path, "content": "aurora\n"},
        )

    result = _call(
        mcp_client, mcp_collection, write_secret, "search_files", {"query": "aurora"}
    )

    structured = result["structuredContent"]
    assert isinstance(structured, dict)
    assert [match["path"] for match in structured["matches"]] == ["/aurora-log.md"]


def test_read_file_refuses_non_utf8_bytes(
    mcp_client: TestClient, mcp_collection: models.Collection, write_secret: str
) -> None:
    """A tool result is model context: binary is refused, never mangled."""
    _call(
        mcp_client,
        mcp_collection,
        write_secret,
        "upload_file",
        {
            "path": "image.bin",
            "content": base64.b64encode(b"\xff\xfe\x00\x01").decode(),
            "encoding": "base64",
        },
    )

    result = _call(
        mcp_client, mcp_collection, write_secret, "read_file", {"path": "image.bin"}
    )

    assert result["isError"] is True
    content = result["content"]
    assert isinstance(content, list)
    assert "not UTF-8 text" in content[0]["text"]
