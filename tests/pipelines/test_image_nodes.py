"""Image intake, PDF image extraction, and the vision shell.

Driven against the real fixtures in `tests/assets/` — a PDF with genuinely
embedded images and a standalone PNG — because the failures worth catching
here are decoding failures, and a synthetic byte string exercises none of
the decode path.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.llm.config import LlmNodeConfig, OutputFieldSpec, TextTarget
from app.pipelines.nodes.images import (
    ImageSourceConfig,
    ImageSourceNode,
    PdfImageExtractorConfig,
    PdfImageExtractorNode,
)
from app.pipelines.nodes.llm_describe import LlmDescribeNode
from app.pipelines.nodes.parsing import FileTypeRouterConfig, FileTypeRouterNode
from app.pipelines.payloads import Item, ItemBatch, MediaAsset, SourcePayload
from app.pipelines.ports import Facet
from app.retrieval.models import DocumentMetadata
from app.retrieval.parsers.base import DocumentSource
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubChatProvider,
    StubProviderResolver,
    StubVectorStoreProvider,
)

ASSETS = Path(__file__).parent.parent / "assets"


def _user() -> models.User:
    return models.User(id=uuid4(), email="images@test.local", hashed_password="hashed")


def _collection(user: models.User) -> models.Collection:
    return models.Collection(
        id=uuid4(), user_id=user.id, name="Images", description="", extra_metadata={}
    )


def _context(
    session: Session,
    storage_path: Path,
    *,
    chat_provider: StubChatProvider | None = None,
    document: models.Document | None = None,
) -> PipelineRunContext:
    user = _user()
    return PipelineRunContext(
        session=session,
        user=user,
        collection=_collection(user),
        document=document,
        query=None,
        top_k=None,
        providers=StubProviderResolver(chat_provider=chat_provider),
        vector_stores=StubVectorStoreProvider(None),
        storage=FileStorage(base_path=storage_path),
        settings=get_settings(),
    )


def _source(path: Path, content_type: str) -> SourcePayload:
    return SourcePayload(
        source=DocumentSource(
            document_id="doc-1",
            path=path,
            content_type=content_type,
            metadata=DocumentMetadata(data={"filename": path.name}),
        )
    )


def test_image_source_emits_one_item_carrying_the_stored_image(
    session: Session, tmp_path: Path
) -> None:
    stored = tmp_path / "collections" / "c" / "files" / "node-1"
    stored.parent.mkdir(parents=True)
    stored.write_bytes((ASSETS / "diagram.png").read_bytes())

    outputs = ImageSourceNode(ImageSourceConfig()).run(
        {"source": _source(stored, "image/png")}, _context(session, tmp_path)
    )

    batch = ItemBatch.model_validate(outputs["items"])
    assert len(batch.items) == 1
    image = batch.items[0].image
    assert image is not None
    assert image.media_type == "image/png"
    assert (image.width, image.height) == (200, 120)
    # The asset points at the original upload — intake copies no bytes.
    assert image.path == "collections/c/files/node-1"
    assert Facet.IMAGE in batch.items[0].facets()


def test_image_source_refuses_a_non_image(session: Session, tmp_path: Path) -> None:
    text = tmp_path / "notes.txt"
    text.write_text("plain text")

    with pytest.raises(InvalidInputError, match="not a supported image type"):
        ImageSourceNode(ImageSourceConfig()).run(
            {"source": _source(text, "text/plain")}, _context(session, tmp_path)
        )


def test_pdf_extractor_writes_each_embedded_image_and_skips_page_furniture(
    session: Session, tmp_path: Path
) -> None:
    """The fixture holds a 480x320 chart and a 24x24 icon on separate pages."""
    context = _context(session, tmp_path)
    outputs = PdfImageExtractorNode(PdfImageExtractorConfig()).run(
        {"source": _source(ASSETS / "images.pdf", "application/pdf")}, context
    )

    batch = ItemBatch.model_validate(outputs["items"])
    assert len(batch.items) == 1  # the icon is under the 64px floor
    item = batch.items[0]
    assert item.image is not None
    assert (item.image.width, item.image.height) == (480, 320)
    assert item.metadata.data["page"] == 1
    assert item.id == "doc-1:img:0"
    # The bytes are on disk where the asset says they are.
    assert (tmp_path / item.image.path).read_bytes() == context.storage.read_bytes(item.image.path)


def test_pdf_extractor_lowered_floor_keeps_the_small_image(
    session: Session, tmp_path: Path
) -> None:
    outputs = PdfImageExtractorNode(PdfImageExtractorConfig(min_width=8, min_height=8)).run(
        {"source": _source(ASSETS / "images.pdf", "application/pdf")}, _context(session, tmp_path)
    )

    batch = ItemBatch.model_validate(outputs["items"])
    assert [(item.image.width, item.image.height) for item in batch.items if item.image] == [
        (480, 320),
        (24, 24),
    ]
    assert [item.metadata.data["page"] for item in batch.items] == [1, 2]


def test_pdf_extractor_refuses_a_non_pdf(session: Session, tmp_path: Path) -> None:
    with pytest.raises(InvalidInputError, match="Wire it to a PDF source"):
        PdfImageExtractorNode(PdfImageExtractorConfig()).run(
            {"source": _source(ASSETS / "diagram.png", "image/png")}, _context(session, tmp_path)
        )


def test_file_type_router_sends_images_to_their_own_port(
    session: Session, tmp_path: Path
) -> None:
    node = FileTypeRouterNode(FileTypeRouterConfig())
    context = _context(session, tmp_path)

    assert set(node.run({"source": _source(Path("a.png"), "image/png")}, context)) == {"image"}
    assert set(node.run({"source": _source(Path("a.pdf"), "application/pdf")}, context)) == {"pdf"}
    assert set(node.run({"source": _source(Path("a.txt"), "text/plain")}, context)) == {"text"}


def _describe_config() -> LlmNodeConfig:
    return LlmNodeConfig(
        connection_id=uuid4(),
        model_name="vision-model",
        prompt="Describe this image.",
        output_fields=[
            OutputFieldSpec(
                name="description",
                type="string",
                description="What the image shows.",
                target=TextTarget(kind="text", mode="append", separator="\n\n"),
            )
        ],
    )


def test_describe_writes_the_model_answer_onto_the_image_item(
    session: Session, tmp_path: Path
) -> None:
    stored = "collections/c/derived/doc-1/page1-0.png"
    storage = FileStorage(base_path=tmp_path)
    storage.write_bytes((ASSETS / "diagram.png").read_bytes(), stored)
    provider = StubChatProvider(
        responses=[{"content": '{"description": "A labelled architecture diagram."}'}]
    )
    context = _context(session, tmp_path, chat_provider=provider)
    item = Item(
        id="doc-1:img:0",
        image=MediaAsset(media_type="image/png", path=stored, byte_size=1883),
        document_id="doc-1",
    )

    outputs = LlmDescribeNode(_describe_config()).run(
        {"items": ItemBatch(items=[item])}, context
    )

    described = ItemBatch.model_validate(outputs["items"]).items[0]
    assert described.text == "A labelled architecture diagram."
    assert described.image is not None  # the image survives alongside its description


def test_describe_attaches_the_image_bytes_to_the_request(
    session: Session, tmp_path: Path
) -> None:
    """The model is sent the image, not a filename — the whole point of the node."""
    stored = "collections/c/derived/doc-1/page1-0.png"
    storage = FileStorage(base_path=tmp_path)
    storage.write_bytes((ASSETS / "diagram.png").read_bytes(), stored)
    provider = StubChatProvider(responses=[{"content": '{"description": "A diagram."}'}])
    context = _context(session, tmp_path, chat_provider=provider)
    item = Item(
        id="doc-1:img:0",
        image=MediaAsset(media_type="image/png", path=stored, byte_size=1883),
        document_id="doc-1",
    )

    LlmDescribeNode(_describe_config()).run({"items": ItemBatch(items=[item])}, context)

    content = provider.requests[0].messages[-1]["content"]
    assert isinstance(content, list)
    image_parts = [part for part in content if part.get("type") == "image_url"]
    assert len(image_parts) == 1
    assert image_parts[0]["image_url"]["url"].startswith("data:image/png;base64,")


def test_describe_passes_text_items_through_untouched(session: Session, tmp_path: Path) -> None:
    """A text chunk sharing the stream is not sent to the vision model."""
    provider = StubChatProvider(responses=[{"content": '{"description": "unused"}'}])
    context = _context(session, tmp_path, chat_provider=provider)
    text_item = Item(id="doc-1:0", text="A paragraph of prose.", document_id="doc-1")

    outputs = LlmDescribeNode(_describe_config()).run(
        {"items": ItemBatch(items=[text_item])}, context
    )

    assert ItemBatch.model_validate(outputs["items"]).items == [text_item]
    assert provider.requests == []


def test_a_documents_own_image_metadata_key_never_crashes_retrieval() -> None:
    """A user metadata key named `image` is theirs; the asset key is reserved.

    The stored asset travels under the namespaced key, so an arbitrary
    `image` value in document metadata neither crashes the rebuild nor is
    mistaken for an asset — and a malformed value under the reserved key
    degrades to a text-only match instead of failing the query.
    """
    from app.pipelines.payloads import IMAGE_ASSET_METADATA_KEY
    from app.retrieval.models import DocumentChunk

    foreign = DocumentChunk(
        document_id="doc-1",
        chunk_id="doc-1:0",
        text="prose",
        order=0,
        metadata=DocumentMetadata(data={"image": {"credit": "NASA"}}),
    )
    rebuilt = Item.from_chunk(foreign)
    assert rebuilt.image is None
    assert rebuilt.metadata.data["image"] == {"credit": "NASA"}

    malformed = DocumentChunk(
        document_id="doc-1",
        chunk_id="doc-1:1",
        text="prose",
        order=1,
        metadata=DocumentMetadata(data={IMAGE_ASSET_METADATA_KEY: {"not": "an asset"}}),
    )
    assert Item.from_chunk(malformed).image is None


def test_an_image_items_asset_round_trips_through_store_metadata() -> None:
    """The stored row carries the asset under the reserved key and rebuilds it."""
    item = Item(
        id="doc-1:img:0",
        image=MediaAsset(media_type="image/png", path="collections/c/derived/doc-1/a.png", byte_size=9),
        document_id="doc-1",
        order=0,
        metadata=DocumentMetadata(data={"filename": "a.png", "image": "user-value"}),
    )
    rebuilt = Item.from_chunk(item.to_chunk())
    assert rebuilt.image == item.image
    assert rebuilt.metadata.data["image"] == "user-value"


def test_inlining_a_stored_image_respects_the_configured_size_limit(
    session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The image cap holds at the provider boundary, not only at upload.

    Lowering the limit after files landed must still bind: inlining recurs
    on every describe/embed/chat call, so an oversized stored image raises
    a clear error instead of shipping megabytes per request.
    """
    from app.pipelines.image_assets import load_inline_media
    from app.schemas.app_config import AppConfig

    del session
    storage = FileStorage(base_path=tmp_path)
    storage.write_bytes(b"x" * (2 * 1024 * 1024), "collections/c/derived/d/big.png")
    config = AppConfig()
    config.uploads.max_image_upload_size_mb = 1
    monkeypatch.setattr("app.pipelines.image_assets.get_app_config", lambda: config)

    with pytest.raises(InvalidInputError, match="1MB image limit"):
        load_inline_media(storage, media_type="image/png", path="collections/c/derived/d/big.png")

    storage.write_bytes(b"ok", "collections/c/derived/d/small.png")
    media = load_inline_media(
        storage, media_type="image/png", path="collections/c/derived/d/small.png"
    )
    assert media.data == b"ok"
