"""Embedding image items: the node partition and the wire shape it sends.

The embedder's contract is its model's, so the same node embeds an image
stream or leaves it alone depending only on what the catalog publishes.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlmodel import Session

from app.clients.openai_compat import embeddings as embeddings_api
from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.payloads import Item, ItemBatch, MediaAsset
from app.schemas.media import InlineMedia
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider

ASSETS = Path(__file__).parent.parent / "assets"
STORED = "collections/c/derived/doc-1/page1-0.png"


class _RecordingEmbedder:
    """Embedder stand-in recording which surface each item went through."""

    def __init__(self, _client: object, model_name: str, dimensions: int | None = None) -> None:
        self.model_name = model_name
        self.dimensions = dimensions
        self.documents: list[str] = []
        self.images: list[InlineMedia] = []

    @property
    def usage(self) -> dict[str, int] | None:
        return None

    def embed_documents(self, chunks: Any) -> list[list[float]]:
        self.documents.extend(chunk.text for chunk in chunks)
        return [[0.1, 0.2] for _ in chunks]

    def embed_query(self, query: str) -> list[float]:
        self.documents.append(query)
        return [0.1, 0.2]

    def embed_images(self, images: Any) -> list[list[float]]:
        self.images.extend(images)
        return [[0.9, 0.8] for _ in self.images]


def _context(
    session: Session, tmp_path: Path, *, modalities: frozenset[str]
) -> tuple[PipelineRunContext, dict[str, _RecordingEmbedder]]:
    made: dict[str, _RecordingEmbedder] = {}

    class _Tracked(_RecordingEmbedder):
        def __init__(self, client: object, model_name: str, dimensions: int | None = None) -> None:
            super().__init__(client, model_name, dimensions)
            made["embedder"] = self

    user = models.User(id=uuid4(), email="embed@test.local", hashed_password="hashed")
    collection = models.Collection(
        id=uuid4(), user_id=user.id, name="Images", description="", extra_metadata={}
    )
    document = models.Document(
        id=uuid4(),
        collection_id=collection.id,
        user_id=user.id,
        name="doc.pdf",
        content_type="application/pdf",
        status=models.DocumentStatus.PROCESSING,
    )
    context = PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=document,
        query=None,
        top_k=None,
        providers=StubProviderResolver(_Tracked, published_modalities=modalities),
        vector_stores=StubVectorStoreProvider(None),
        storage=FileStorage(base_path=tmp_path),
        settings=get_settings(),
    )
    return context, made


def _image_item() -> Item:
    return Item(
        id="doc-1:img:0",
        image=MediaAsset(media_type="image/png", path=STORED, byte_size=1883),
        document_id="doc-1",
    )


def test_an_image_capable_model_embeds_the_image_bytes(session: Session, tmp_path: Path) -> None:
    FileStorage(base_path=tmp_path).write_bytes((ASSETS / "diagram.png").read_bytes(), STORED)
    context, made = _context(session, tmp_path, modalities=frozenset({"text", "image"}))
    batch = ItemBatch(items=[_image_item(), Item(id="doc-1:0", text="prose", document_id="doc-1")])

    outputs = EmbedderNode(EmbedderConfig(connection_id=uuid4(), model_name="m")).run(
        {"items": batch}, context
    )

    embedder = made["embedder"]
    assert [media.media_type for media in embedder.images] == ["image/png"]
    assert embedder.documents == ["prose"]
    items = ItemBatch.model_validate(outputs["items"]).items
    # Both items come out embedded, and in their original stream order.
    assert [item.id for item in items] == ["doc-1:img:0", "doc-1:0"]
    assert all(item.embedding is not None for item in items)


def test_a_text_only_model_leaves_the_image_unembedded(session: Session, tmp_path: Path) -> None:
    FileStorage(base_path=tmp_path).write_bytes((ASSETS / "diagram.png").read_bytes(), STORED)
    context, made = _context(session, tmp_path, modalities=frozenset({"text"}))
    batch = ItemBatch(items=[_image_item(), Item(id="doc-1:0", text="prose", document_id="doc-1")])

    outputs = EmbedderNode(EmbedderConfig(connection_id=uuid4(), model_name="m")).run(
        {"items": batch}, context
    )

    embedder = made["embedder"]
    assert embedder.images == []
    assert embedder.documents == ["prose"]
    items = {item.id: item for item in ItemBatch.model_validate(outputs["items"]).items}
    assert items["doc-1:0"].embedding is not None
    # Passed through untouched — the dense indexer excludes it downstream.
    assert items["doc-1:img:0"].embedding is None


def test_image_embedding_sends_the_multimodal_input_shape() -> None:
    """A multimodal embeddings request wraps each image in a content array."""
    captured: dict[str, Any] = {}

    class _Sdk:
        class embeddings:
            @staticmethod
            def create(**kwargs: Any) -> Any:
                captured.update(kwargs)

                class _Response:
                    @staticmethod
                    def model_dump() -> dict[str, Any]:
                        return {"data": [{"embedding": [0.1, 0.2], "index": 0}]}

                return _Response()

    class _Transport:
        sdk = _Sdk()

        @staticmethod
        def merge_headers(extra: dict[str, str] | None) -> dict[str, str]:
            return extra or {}

    media = InlineMedia(media_type="image/png", data=b"\x89PNG\r\n\x1a\n")
    embeddings_api.embed_media(_Transport(), [media], model="multimodal-embed")  # type: ignore[arg-type]

    assert captured["model"] == "multimodal-embed"
    assert captured["encoding_format"] == "float"
    assert captured["input"] == [
        {
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": media.data_uri()},
                }
            ]
        }
    ]
    # No `dimensions` unless one was requested — most models reject it.
    assert "dimensions" not in captured
