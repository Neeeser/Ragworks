"""The capability parse nodes, driven against real files.

Every node here dispatches on content type through its registry, so the
cases that matter are: a type the registry answers for, a type it does
not, and a non-file item sharing the stream. Real fixtures (a PDF with
embedded images, a PNG) because decoding is where malformed input bites.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.merging import MergeItemsConfig, MergeItemsNode
from app.pipelines.nodes.parsing import ParseTextConfig, ParseTextNode
from app.pipelines.nodes.parsing_media import (
    ParseEmbeddedMediaConfig,
    ParseEmbeddedMediaNode,
    ParseMediaFileConfig,
    ParseMediaFileNode,
    ParsePageImagesConfig,
    ParsePageImagesNode,
)
from app.pipelines.payloads import Item, ItemBatch, MediaAsset
from app.pipelines.ports import Facet
from app.retrieval.models import DocumentMetadata
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider

ASSETS = Path(__file__).parent.parent / "assets"


def _context(session: Session, storage_path: Path) -> PipelineRunContext:
    user = models.User(id=uuid4(), email="parse@test.local", hashed_password="hashed")
    return PipelineRunContext(
        session=session,
        user=user,
        collection=models.Collection(
            id=uuid4(), user_id=user.id, name="Parse", description="", extra_metadata={}
        ),
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(None),
        storage=FileStorage(base_path=storage_path),
        settings=get_settings(),
    )


def _stored(storage_path: Path, source: Path, name: str) -> str:
    """Copy a fixture into storage and return its storage-relative path."""
    relative = f"collections/c/files/{name}"
    FileStorage(base_path=storage_path).write_bytes(source.read_bytes(), relative)
    return relative


def _file_item(relative: str, media_type: str, *, document_id: str = "doc-1") -> Item:
    return Item(
        id=document_id,
        file=MediaAsset(media_type=media_type, path=relative, byte_size=1),
        document_id=document_id,
        order=0,
        metadata=DocumentMetadata(data={"filename": Path(relative).name}),
    )


def _batch(*items: Item) -> dict[str, object]:
    return {"source": ItemBatch(items=list(items))}


def test_extract_text_reads_a_pdfs_text_layer(session: Session, tmp_path: Path) -> None:
    relative = _stored(tmp_path, ASSETS / "sample.pdf", "doc.pdf")

    outputs = ParseTextNode(ParseTextConfig()).run(
        _batch(_file_item(relative, "application/pdf")), _context(session, tmp_path)
    )

    batch = ItemBatch.model_validate(outputs["items"])
    assert len(batch.items) == 1
    assert batch.items[0].text is not None
    # The text item keeps the file item's id, so chunk ids stay
    # `{document_id}:{n}` for vector ids and per-document deletion.
    assert batch.items[0].id == "doc-1"
    assert batch.items[0].facets() == {Facet.TEXT}


def test_extract_text_emits_nothing_for_an_empty_text_layer(
    session: Session, tmp_path: Path
) -> None:
    """A PDF whose text layer is empty produces no item, only a warning.

    An emitted empty-text item reaches the index as an empty chunk and
    every downstream node has to special-case it; the file was still read,
    so it is not an unhandled type.
    """
    relative = _stored(tmp_path, ASSETS / "images.pdf", "figures.pdf")
    node = ParseTextNode(ParseTextConfig())
    inputs = _batch(_file_item(relative, "application/pdf"))
    context = _context(session, tmp_path)

    outputs = node.run(inputs, context)

    assert ItemBatch.model_validate(outputs["items"]).items == []
    assert context.parse_report.unclaimed_media_types() == []
    warnings = [
        value for value in node.summarize_io(inputs, outputs).outputs if value.label == "Warnings"
    ]
    assert len(warnings) == 1
    assert "carries no text" in str(warnings[0].value)


def test_extract_text_decodes_a_plain_text_file(session: Session, tmp_path: Path) -> None:
    (tmp_path / "collections/c/files").mkdir(parents=True)
    (tmp_path / "collections/c/files/notes.txt").write_text("hello notes", encoding="utf-8")

    outputs = ParseTextNode(ParseTextConfig()).run(
        _batch(_file_item("collections/c/files/notes.txt", "text/plain")),
        _context(session, tmp_path),
    )

    assert ItemBatch.model_validate(outputs["items"]).items[0].text == "hello notes"


def test_extract_text_skips_an_unhandled_type_and_says_so(session: Session, tmp_path: Path) -> None:
    """An unmatched type used to dead-end silently; it now reports."""
    relative = _stored(tmp_path, ASSETS / "diagram.png", "diagram.png")
    node = ParseTextNode(ParseTextConfig())
    inputs = _batch(_file_item(relative, "image/png"))

    outputs = node.run(inputs, _context(session, tmp_path))

    assert ItemBatch.model_validate(outputs["items"]).items == []
    warnings = [
        value for value in node.summarize_io(inputs, outputs).outputs if value.label == "Warnings"
    ]
    assert len(warnings) == 1
    assert "image/png" in str(warnings[0].value)
    # The declined type is data too: a viewer explaining an empty output has
    # to tell "no handler" apart from "read it and it held nothing".
    unread = next(
        value
        for value in node.summarize_io(inputs, outputs).outputs
        if value.label == "Unread files"
    )
    assert unread.value == {"count": 1, "media_types": ["image/png"]}


def test_extract_text_plain_text_policy_decodes_an_unknown_format(
    session: Session, tmp_path: Path
) -> None:
    (tmp_path / "collections/c/files").mkdir(parents=True)
    (tmp_path / "collections/c/files/config.yaml").write_text("key: value", encoding="utf-8")

    outputs = ParseTextNode(ParseTextConfig(unknown_format="plain_text")).run(
        _batch(_file_item("collections/c/files/config.yaml", "application/x-yaml")),
        _context(session, tmp_path),
    )

    assert ItemBatch.model_validate(outputs["items"]).items[0].text == "key: value"


def test_extract_text_plain_text_policy_declines_an_image(
    session: Session, tmp_path: Path
) -> None:
    """Image bytes decoded as text are mojibake, never content.

    The policy covers formats the app has no modality for; an image has one,
    so a text-only pipeline records the upload unsupported rather than
    indexing its bytes.
    """
    relative = _stored(tmp_path, ASSETS / "diagram.png", "diagram.png")
    node = ParseTextNode(ParseTextConfig(unknown_format="plain_text"))
    context = _context(session, tmp_path)

    outputs = node.run(_batch(_file_item(relative, "image/png")), context)

    assert ItemBatch.model_validate(outputs["items"]).items == []
    assert context.parse_report.unclaimed_media_types() == ["image/png"]


def test_extract_text_never_emits_nul_bytes(session: Session, tmp_path: Path) -> None:
    """A Postgres text column rejects NUL, so extraction must not produce one."""
    (tmp_path / "collections/c/files").mkdir(parents=True)
    (tmp_path / "collections/c/files/notes.txt").write_bytes(b"before\x00after")

    outputs = ParseTextNode(ParseTextConfig()).run(
        _batch(_file_item("collections/c/files/notes.txt", "text/plain")),
        _context(session, tmp_path),
    )

    assert ItemBatch.model_validate(outputs["items"]).items[0].text == "beforeafter"


def test_a_parse_node_passes_non_file_items_through(session: Session, tmp_path: Path) -> None:
    """A parse node inserted mid-stream never destroys data."""
    relative = _stored(tmp_path, ASSETS / "diagram.png", "diagram.png")
    chunk = Item(id="doc-0:0", text="an existing chunk", document_id="doc-0")

    outputs = ParseMediaFileNode(ParseMediaFileConfig()).run(
        {"source": ItemBatch(items=[chunk, _file_item(relative, "image/png")])},
        _context(session, tmp_path),
    )

    items = ItemBatch.model_validate(outputs["items"]).items
    assert chunk in items
    assert [item.image is not None for item in items].count(True) == 1


def test_media_file_emits_the_upload_as_one_image_item(session: Session, tmp_path: Path) -> None:
    relative = _stored(tmp_path, ASSETS / "diagram.png", "diagram.png")

    outputs = ParseMediaFileNode(ParseMediaFileConfig()).run(
        _batch(_file_item(relative, "image/png")), _context(session, tmp_path)
    )

    item = ItemBatch.model_validate(outputs["items"]).items[0]
    assert item.image is not None
    assert (item.image.width, item.image.height) == (200, 120)
    # The asset points at the original upload — intake copies no bytes.
    assert item.image.path == relative
    assert item.facets() == {Facet.IMAGE}


def test_extract_media_writes_each_embedded_image_and_skips_page_furniture(
    session: Session, tmp_path: Path
) -> None:
    """The fixture holds a 480x320 chart and a 24x24 icon on separate pages."""
    relative = _stored(tmp_path, ASSETS / "images.pdf", "images.pdf")
    context = _context(session, tmp_path)

    outputs = ParseEmbeddedMediaNode(ParseEmbeddedMediaConfig()).run(
        _batch(_file_item(relative, "application/pdf")), context
    )

    batch = ItemBatch.model_validate(outputs["items"])
    assert len(batch.items) == 1  # the icon is under the 64px floor
    item = batch.items[0]
    assert item.image is not None
    assert (item.image.width, item.image.height) == (480, 320)
    assert item.metadata.data["page"] == 1
    assert item.id == "doc-1:img:0"
    assert (tmp_path / item.image.path).read_bytes() == context.storage.read_bytes(item.image.path)


def test_extract_media_lowered_floor_keeps_the_small_image(
    session: Session, tmp_path: Path
) -> None:
    relative = _stored(tmp_path, ASSETS / "images.pdf", "images.pdf")

    outputs = ParseEmbeddedMediaNode(ParseEmbeddedMediaConfig(min_width=8, min_height=8)).run(
        _batch(_file_item(relative, "application/pdf")), _context(session, tmp_path)
    )

    batch = ItemBatch.model_validate(outputs["items"])
    assert [(item.image.width, item.image.height) for item in batch.items if item.image] == [
        (480, 320),
        (24, 24),
    ]
    assert [item.metadata.data["page"] for item in batch.items] == [1, 2]


def test_render_as_images_rasterizes_every_page(session: Session, tmp_path: Path) -> None:
    relative = _stored(tmp_path, ASSETS / "images.pdf", "images.pdf")
    context = _context(session, tmp_path)

    outputs = ParsePageImagesNode(ParsePageImagesConfig(dpi=72)).run(
        _batch(_file_item(relative, "application/pdf")), context
    )

    batch = ItemBatch.model_validate(outputs["items"])
    assert [item.metadata.data["page"] for item in batch.items] == [1, 2]
    first = batch.items[0]
    assert first.id == "doc-1:page:0"
    assert first.image is not None
    assert first.image.media_type == "image/png"
    assert context.storage.read_bytes(first.image.path).startswith(b"\x89PNG")


def test_render_as_images_stops_at_max_pages(session: Session, tmp_path: Path) -> None:
    relative = _stored(tmp_path, ASSETS / "images.pdf", "images.pdf")

    outputs = ParsePageImagesNode(ParsePageImagesConfig(dpi=72, max_pages=1)).run(
        _batch(_file_item(relative, "application/pdf")), _context(session, tmp_path)
    )

    assert len(ItemBatch.model_validate(outputs["items"]).items) == 1


def test_a_missing_stored_file_fails_the_run(session: Session, tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        ParseTextNode(ParseTextConfig()).run(
            _batch(_file_item("collections/c/files/gone.txt", "text/plain")),
            _context(session, tmp_path),
        )


def test_merge_concatenates_every_branch_in_run_order(session: Session, tmp_path: Path) -> None:
    text = ItemBatch(items=[Item(id="doc-1:0", text="prose", document_id="doc-1")])
    images = ItemBatch(
        items=[
            Item(
                id="doc-1:img:0",
                image=MediaAsset(media_type="image/png", path="a.png", byte_size=2),
                document_id="doc-1",
            )
        ]
    )
    node = MergeItemsNode(MergeItemsConfig())
    inputs: dict[str, object] = {"items": [text, images]}

    outputs = node.run(inputs, _context(session, tmp_path))

    merged = ItemBatch.model_validate(outputs["items"])
    assert [item.id for item in merged.items] == ["doc-1:0", "doc-1:img:0"]
    summary = node.summarize_io(inputs, outputs)
    assert [value.label for value in summary.inputs] == ["Items (branch 1)", "Items (branch 2)"]
    merged_items = next(value for value in summary.outputs if value.label == "Merged items").value
    assert [ref.id for ref in merged_items.items] == ["doc-1:0", "doc-1:img:0"]  # type: ignore[union-attr]


def test_a_parse_nodes_file_summary_matches_the_upload_summary(
    session: Session, tmp_path: Path
) -> None:
    """One file-summary shape across the trace, so a viewer can read it.

    The trace card that renders files needs the path and size, and the
    key set is also what separates a file summary from an image one.
    """
    relative = _stored(tmp_path, ASSETS / "images.pdf", "doc.pdf")
    node = ParseTextNode(ParseTextConfig())
    inputs = _batch(_file_item(relative, "application/pdf"))

    outputs = node.run(inputs, _context(session, tmp_path))

    files = next(
        value for value in node.summarize_io(inputs, outputs).inputs if value.label == "Files"
    )
    assert files.value == {
        "count": 1,
        "media_types": ["application/pdf"],
        "paths": [relative],
        "byte_size": 1,
    }
