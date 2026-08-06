"""Retrieved image assets follow a tool result to vision models only.

The contract: a session model whose catalog publishes image input gets the
tool result's images as a user message of content parts; any other model —
text-only or unstated — gets nothing beyond the placeholder text already
in the tool JSON, because transmitting bytes an unknown model may reject
fails the chat turn.
"""

from __future__ import annotations

from pathlib import Path as _Path
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.chat import attachments
from app.chat.attachments import image_attachment_message
from app.db import models
from app.pipelines.payloads import IMAGE_ASSET_METADATA_KEY
from app.utils.file_storage import FileStorage

#: Fake bytes for storage/replay paths that never decode the image.
PNG = b"\x89PNG\r\n\x1a\n-bytes"
#: A real decodable PNG, for the store path that verifies decodability.
REAL_PNG = (_Path(__file__).parent.parent / "assets" / "diagram.png").read_bytes()


class _StubResolver:
    def __init__(self, *_args: object, modalities: frozenset[str]) -> None:
        self._modalities = modalities

    def input_modalities(self, *_args: object) -> frozenset[str]:
        return self._modalities


def _publishing(monkeypatch: pytest.MonkeyPatch, *modalities: str) -> None:
    published = frozenset(modalities)
    monkeypatch.setattr(
        attachments,
        "ProviderResolver",
        lambda user, session: _StubResolver(modalities=published),
    )


def _session_model() -> models.ChatSession:
    return models.ChatSession(
        id=uuid4(),
        user_id=uuid4(),
        provider_connection_id=uuid4(),
        chat_model="vision-model",
    )


def _payload(paths: list[str]) -> dict[str, object]:
    return {
        "chunks": [
            {
                "chunk_id": f"doc:img:{index}",
                "text": "[image: a.png]",
                "metadata": {
                    IMAGE_ASSET_METADATA_KEY: {
                        "media_type": "image/png",
                        "path": path,
                        "byte_size": len(PNG),
                    }
                },
            }
            for index, path in enumerate(paths)
        ]
    }


def _store(path: str) -> None:
    FileStorage().write_bytes(PNG, path)


def test_a_vision_model_gets_the_images_as_content_parts(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _publishing(monkeypatch, "text", "image")
    path = f"collections/{uuid4()}/derived/d/a.png"
    _store(path)

    message = image_attachment_message(
        user=models.User(id=uuid4(), email="a@b.c", hashed_password="x"),
        session=session,
        session_model=_session_model(),
        response_payload=_payload([path]),
    )

    assert message is not None
    assert isinstance(message.content, list)
    kinds = [part.type for part in message.content]
    assert kinds == ["text", "image_url"]
    assert message.content[1].image_url.url.startswith("data:image/png;base64,")


def test_a_model_without_published_image_input_gets_nothing_extra(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Text-only and unstated both send no bytes — unstated may reject them."""
    path = f"collections/{uuid4()}/derived/d/a.png"
    _store(path)
    user = models.User(id=uuid4(), email="a@b.c", hashed_password="x")

    for published in [("text",), ()]:
        _publishing(monkeypatch, *published)
        assert (
            image_attachment_message(
                user=user,
                session=session,
                session_model=_session_model(),
                response_payload=_payload([path]),
            )
            is None
        )


def test_duplicate_and_capped_assets(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """One image per distinct asset, at most MAX_IMAGES_PER_TOOL_RESULT."""
    _publishing(monkeypatch, "image")
    prefix = f"collections/{uuid4()}/derived/d"
    paths = [f"{prefix}/{index}.png" for index in range(6)]
    for path in paths:
        _store(path)

    message = image_attachment_message(
        user=models.User(id=uuid4(), email="a@b.c", hashed_password="x"),
        session=session,
        session_model=_session_model(),
        response_payload=_payload([paths[0], *paths]),
    )

    assert message is not None
    assert isinstance(message.content, list)
    image_parts = [part for part in message.content if part.type == "image_url"]
    assert len(image_parts) == attachments.MAX_IMAGES_PER_TOOL_RESULT


def test_unreadable_assets_degrade_to_no_attachment(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _publishing(monkeypatch, "image")

    assert (
        image_attachment_message(
            user=models.User(id=uuid4(), email="a@b.c", hashed_password="x"),
            session=session,
            session_model=_session_model(),
            response_payload=_payload([f"collections/{uuid4()}/derived/d/missing.png"]),
        )
        is None
    )


def test_send_bar_attachments_store_and_replay_as_content_parts(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An attached image persists under the session's directory and replays.

    The stored row carries the asset record, and rebuilding the provider
    message from that row yields text + image parts — which is what makes
    a later turn's history still show the model the image.
    """
    import base64

    from app.chat.attachments import store_chat_attachments
    from app.chat.persistence import provider_message_from_model
    from app.schemas.chat import ChatImageAttachment

    del session, monkeypatch
    session_id = uuid4()
    stored = store_chat_attachments(
        session_id,
        [ChatImageAttachment(media_type="image/png", data=base64.b64encode(REAL_PNG).decode())],
    )

    assert len(stored) == 1
    assert stored[0]["path"].startswith(f"chat/{session_id}/")
    assert FileStorage().read_bytes(stored[0]["path"]) == REAL_PNG

    row = models.ChatMessage(
        session_id=session_id,
        role=models.ChatRole.USER,
        content="what is this?",
        attachments=stored,
    )
    message = provider_message_from_model(row)
    assert isinstance(message.content, list)
    assert [part.type for part in message.content] == ["text", "image_url"]


def test_send_bar_attachments_are_validated_as_input() -> None:
    import base64

    from app.chat.attachments import store_chat_attachments
    from app.schemas.chat import ChatImageAttachment
    from app.services.errors import InvalidInputError

    with pytest.raises(InvalidInputError, match="not a supported image type"):
        store_chat_attachments(
            uuid4(),
            [ChatImageAttachment(media_type="image/tiff", data=base64.b64encode(PNG).decode())],
        )
    with pytest.raises(InvalidInputError, match="not valid base64"):
        store_chat_attachments(
            uuid4(), [ChatImageAttachment(media_type="image/png", data="!!not-base64!!")]
        )
    with pytest.raises(InvalidInputError, match="not a decodable image"):
        store_chat_attachments(
            uuid4(),
            [ChatImageAttachment(media_type="image/png", data=base64.b64encode(PNG).decode())],
        )


def test_image_parts_are_stripped_for_a_model_that_cannot_read_them(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A session switched to a text-only model keeps working: text survives,
    bytes are withheld rather than triggering a provider 400 on history."""
    from app.chat.attachments import strip_unreadable_image_parts

    messages = [
        {"role": "system", "content": "sys"},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "what is this?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
            ],
        },
    ]
    user = models.User(id=uuid4(), email="a@b.c", hashed_password="x")

    _publishing(monkeypatch, "text")
    stripped = strip_unreadable_image_parts(
        messages, user=user, session=session, session_model=_session_model()
    )
    assert stripped[1]["content"] == "what is this?"

    _publishing(monkeypatch, "text", "image")
    kept = strip_unreadable_image_parts(
        messages, user=user, session=session, session_model=_session_model()
    )
    assert kept[1]["content"] == messages[1]["content"]


def test_a_stored_attachment_over_a_lowered_cap_degrades_to_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """History rebuild survives a size cap lowered after the image landed.

    The oversized asset is withheld and the message replays as its text —
    never an exception out of the request build, which would kill every
    later turn of the session.
    """
    from app.chat.persistence import provider_message_from_model
    from app.schemas.app_config import AppConfig

    session_id = uuid4()
    path = f"chat/{session_id}/big.png"
    FileStorage().write_bytes(b"x" * (2 * 1024 * 1024), path)
    config = AppConfig()
    config.uploads.max_image_upload_size_mb = 1
    monkeypatch.setattr("app.pipelines.image_assets.get_app_config", lambda: config)

    row = models.ChatMessage(
        session_id=session_id,
        role=models.ChatRole.USER,
        content="what is this?",
        attachments=[{"media_type": "image/png", "path": path, "byte_size": 2097152}],
    )
    message = provider_message_from_model(row)
    assert message.content == "what is this?"


class _ImageMatchInvocationService:
    """Invocation stub whose every result references a stored image asset."""

    def __init__(self, asset_path: str) -> None:
        self._asset_path = asset_path

    def invoke_binding(
        self,
        _user: models.User,
        _collection: models.Collection,
        binding_id: object,
        query: str,
        top_k: int | None = None,
        arguments: dict[str, object] | None = None,
    ) -> object:
        del arguments
        from app.schemas.tools import ToolInvocationResponse

        return ToolInvocationResponse(
            kind="chunks",
            tool_binding_id=binding_id,
            query=query,
            top_k=top_k if top_k is not None else 5,
            chunks=[
                {
                    "chunk_id": "doc:img:0",
                    "document_id": "doc",
                    "text": "[image: a.png]",
                    "score": 0.9,
                    "metadata": {
                        IMAGE_ASSET_METADATA_KEY: {
                            "media_type": "image/png",
                            "path": self._asset_path,
                            "byte_size": len(PNG),
                        }
                    },
                }
            ],
            usage={},
        )


def test_two_tool_calls_keep_every_tool_result_beside_its_assistant_message(
    session: Session, chat_user, make_collection, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Image attachments never separate one tool result from the next.

    A provider rejects a `tool` message that does not directly follow the
    assistant message carrying its `tool_calls`, so appending the image
    message inside the per-call loop kills the next request build — and
    two calls per turn is the ordinary shape once a session has several
    collections bound.
    """
    import json as _json

    from app.chat.messages import FunctionCall, ToolCall
    from app.chat.state import RunState, ToolExecutionContext
    from app.chat.tools import ToolExecutor
    from app.db.repositories import ChatRepository
    from app.schemas.chat import ChatMessageCreate
    from tests.chat.conftest import make_tool_context

    _publishing(monkeypatch, "text", "image")
    path = f"collections/{uuid4()}/derived/d/a.png"
    _store(path)
    collection = make_collection(chat_user)
    connection = models.ProviderConnection(
        user_id=chat_user.id,
        provider_type="openrouter",
        label="OpenRouter",
        config={"api_key": "key"},
    )
    session.add(connection)
    session.commit()
    session.refresh(connection)
    chat_session = models.ChatSession(
        user_id=chat_user.id,
        title="Two calls",
        chat_model="vision-model",
        provider_connection_id=connection.id,
    )
    session.add(chat_session)
    session.commit()
    session.refresh(chat_session)

    executor = ToolExecutor(
        session=session,
        chat_repo=ChatRepository(session),
        invocation=_ImageMatchInvocationService(path),  # type: ignore[arg-type]
    )
    tool_context = make_tool_context(collection, tool_name="search_docs")
    context = ToolExecutionContext(
        user=chat_user,
        payload=ChatMessageCreate(content="hi", tool_collection_ids=[collection.id]),
        session_model=chat_session,
        messages=[],
        run_state=RunState(),
        shared_tool_reasoning=None,
        tool_collection_map={"search_docs": tool_context},
    )
    calls = [
        ToolCall(
            id=f"call-{index}",
            function=FunctionCall(name="search_docs", arguments=_json.dumps({"query": "q"})),
        )
        for index in range(2)
    ]

    list(executor.execute(tool_calls=calls, context=context))

    roles = [message.role for message in context.messages]
    # Every tool result first, then the images: no user message may sit
    # between an assistant's tool_calls and any of their tool replies.
    assert roles.count("tool") == 2
    assert roles.index("user") > max(
        index for index, role in enumerate(roles) if role == "tool"
    )


def test_an_edit_request_rejects_attachments() -> None:
    """Attachments beside `edit_message_id` are refused at the boundary.

    The edit path rewrites text only — it never stores or forwards
    attachments — so accepting them would drop the images silently.
    """
    import pydantic

    from app.schemas.chat import ChatImageAttachment, ChatMessageCreate

    with pytest.raises(pydantic.ValidationError, match="editing"):
        ChatMessageCreate(
            content="look again",
            edit_message_id=uuid4(),
            attachments=[ChatImageAttachment(media_type="image/png", data="AA==")],
        )
