"""Retrieved image assets follow a tool result to vision models only.

The contract: a session model whose catalog publishes image input gets the
tool result's images as a user message of content parts; any other model —
text-only or unstated — gets nothing beyond the placeholder text already
in the tool JSON, because transmitting bytes an unknown model may reject
fails the chat turn.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.chat import attachments
from app.chat.attachments import image_attachment_message
from app.db import models
from app.pipelines.payloads import IMAGE_ASSET_METADATA_KEY
from app.utils.file_storage import FileStorage

PNG = b"\x89PNG\r\n\x1a\n-bytes"


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
    kinds = [part["type"] for part in message.content]
    assert kinds == ["text", "image_url"]
    assert message.content[1]["image_url"]["url"].startswith("data:image/png;base64,")


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
    image_parts = [part for part in message.content if part["type"] == "image_url"]
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
        [ChatImageAttachment(media_type="image/png", data=base64.b64encode(PNG).decode())],
    )

    assert len(stored) == 1
    assert stored[0]["path"].startswith(f"chat/{session_id}/")
    assert FileStorage().read_bytes(stored[0]["path"]) == PNG

    row = models.ChatMessage(
        session_id=session_id,
        role=models.ChatRole.USER,
        content="what is this?",
        attachments=stored,
    )
    message = provider_message_from_model(row)
    assert isinstance(message.content, list)
    assert [part["type"] for part in message.content] == ["text", "image_url"]


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
