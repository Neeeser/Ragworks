"""The image transform nodes: resize and tile.

Both nodes rewrite stored bytes, so the cases that matter are the pixel
arithmetic (fit, clip, never upscale), what happens to the items that are
not images, and an asset whose bytes will not decode. Images are encoded
with Pillow into the run's storage rather than asserted on in the
abstract — the decode path is where an awkward source image bites.
"""

from __future__ import annotations

import io
from pathlib import Path
from uuid import uuid4

import pytest
from PIL import Image
from pydantic import ValidationError
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.image_transform import (
    ImageResizeConfig,
    ImageResizeNode,
    ImageTileConfig,
    ImageTileNode,
)
from app.pipelines.payloads import Item, ItemBatch, MediaAsset, TextAffixes
from app.retrieval.models import DocumentMetadata
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider

ASSETS = Path(__file__).parent.parent / "assets"


def _context(session: Session, storage_path: Path) -> PipelineRunContext:
    user = models.User(id=uuid4(), email="transform@test.local", hashed_password="hashed")
    return PipelineRunContext(
        session=session,
        user=user,
        collection=models.Collection(
            id=uuid4(), user_id=user.id, name="Images", description="", extra_metadata={}
        ),
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(None),
        storage=FileStorage(base_path=storage_path),
        settings=get_settings(),
    )


def _write_image(
    context: PipelineRunContext, name: str, size: tuple[int, int], image_format: str = "PNG"
) -> str:
    """Encode an image of `size` into storage and return its relative path."""
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(120, 40, 200)).save(buffer, format=image_format)
    relative = f"collections/c/derived/doc-1/{name}"
    context.storage.write_bytes(buffer.getvalue(), relative)
    return relative


def _write_bytes(context: PipelineRunContext, name: str, data: bytes) -> str:
    relative = f"collections/c/derived/doc-1/{name}"
    context.storage.write_bytes(data, relative)
    return relative


def _rotated_photo(size: tuple[int, int]) -> bytes:
    """A JPEG whose EXIF orientation says it is stored a quarter turn off."""
    exif = Image.Exif()
    exif[274] = 6  # Orientation: rotate the stored pixels to display them.
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(10, 60, 120)).save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def _palette_checkerboard(size: tuple[int, int]) -> bytes:
    """A four-colour palette PNG — the shape a scanned line drawing arrives in."""
    width, height = size
    image = Image.frombytes(
        "P", size, bytes((x + y) % 4 for y in range(height) for x in range(width))
    )
    image.putpalette([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255] + [0] * (768 - 12))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _animation(size: tuple[int, int], frames: int) -> bytes:
    """An animated GIF — a legitimate upload, since GIF is an accepted type."""
    images = [Image.new("RGB", size, (index * 40, 0, 0)) for index in range(frames)]
    buffer = io.BytesIO()
    images[0].save(buffer, format="GIF", save_all=True, append_images=images[1:])
    return buffer.getvalue()


def _image_item(path: str, *, media_type: str = "image/png") -> Item:
    return Item(
        id="doc-1:page:0",
        image=MediaAsset(media_type=media_type, path=path, byte_size=1),
        document_id="doc-1",
        order=0,
        metadata=DocumentMetadata(data={"filename": "doc.pdf", "page": 1}),
    )


def _run(
    node: ImageResizeNode | ImageTileNode, items: list[Item], context: PipelineRunContext
) -> list[Item]:
    outputs = node.run({"items": ItemBatch(items=items)}, context)
    return ItemBatch.model_validate(outputs["items"]).items


def _sizes(items: list[Item]) -> list[tuple[int | None, int | None]]:
    return [(item.image.width, item.image.height) for item in items if item.image is not None]


def _stored_size(context: PipelineRunContext, item: Item) -> tuple[int, int]:
    """The dimensions of the bytes actually on disk for an item's asset."""
    assert item.image is not None
    with Image.open(io.BytesIO(context.storage.read_bytes(item.image.path))) as image:
        return image.width, image.height


def test_resize_fits_a_landscape_image_inside_the_box(session: Session, tmp_path: Path) -> None:
    """The bytes are rewritten, the item's identity is not."""
    context = _context(session, tmp_path)
    source = _write_image(context, "page0.png", (3000, 2000))

    items = _run(ImageResizeNode(ImageResizeConfig()), [_image_item(source)], context)

    assert len(items) == 1
    resized = items[0]
    assert resized.image is not None
    assert (resized.image.width, resized.image.height) == (1568, 1045)
    assert _stored_size(context, resized) == (1568, 1045)
    # Stored under the document's derived directory, which is exactly what
    # the delete and re-ingest purges remove.
    assert resized.image.path.startswith(
        context.storage.derived_dir(context.collection.id, "doc-1")
    )
    assert resized.image.path.endswith("page0-r1568x1045.png")
    assert (resized.id, resized.document_id, resized.order) == ("doc-1:page:0", "doc-1", 0)
    assert resized.metadata.data == {"filename": "doc.pdf", "page": 1}


def test_resize_fits_a_portrait_image_inside_the_box(session: Session, tmp_path: Path) -> None:
    context = _context(session, tmp_path)
    source = _write_image(context, "tall.png", (2000, 3000))

    items = _run(ImageResizeNode(ImageResizeConfig()), [_image_item(source)], context)

    assert items[0].image is not None
    assert (items[0].image.width, items[0].image.height) == (1045, 1568)


def test_resize_leaves_an_image_already_inside_the_box_alone(
    session: Session, tmp_path: Path
) -> None:
    """No upscale and no write: the bytes would be identical every run."""
    context = _context(session, tmp_path)
    relative = "collections/c/files/diagram.png"
    context.storage.write_bytes((ASSETS / "diagram.png").read_bytes(), relative)
    item = _image_item(relative)
    node = ImageResizeNode(ImageResizeConfig())

    items = _run(node, [item], context)

    assert items == [item]
    assert not (tmp_path / context.storage.derived_dir(context.collection.id, "doc-1")).exists()
    assert node.stats() == {"resized": 0, "unchanged": 1, "unreadable": 0}


def test_resize_passes_an_unreadable_image_through_with_a_warning(
    session: Session, tmp_path: Path
) -> None:
    """A stored asset that will not decode is metadata trouble, not a failure."""
    context = _context(session, tmp_path)
    relative = "collections/c/derived/doc-1/broken.png"
    context.storage.write_bytes(b"not an image", relative)
    item = _image_item(relative)
    node = ImageResizeNode(ImageResizeConfig())
    inputs = {"items": ItemBatch(items=[item])}

    outputs = node.run(inputs, context)

    assert ItemBatch.model_validate(outputs["items"]).items == [item]
    # Never decoded is its own count: reporting it as unchanged would claim
    # the image was measured and found to fit.
    assert node.stats() == {"resized": 0, "unchanged": 0, "unreadable": 1}
    warnings = next(
        value for value in node.summarize_io(inputs, outputs).outputs if value.label == "Warnings"
    )
    assert "doc-1:page:0" in str(warnings.value)


def test_resize_reencodes_a_jpeg_as_a_jpeg(session: Session, tmp_path: Path) -> None:
    """The stored media type stays true of the bytes behind it."""
    context = _context(session, tmp_path)
    source = _write_image(context, "photo.jpg", (4000, 3000), image_format="JPEG")

    items = _run(
        ImageResizeNode(ImageResizeConfig(max_width=800, max_height=800)),
        [_image_item(source, media_type="image/jpeg")],
        context,
    )

    assert items[0].image is not None
    assert items[0].image.media_type == "image/jpeg"
    assert items[0].image.path.endswith("photo-r800x600.jpg")
    assert context.storage.read_bytes(items[0].image.path).startswith(b"\xff\xd8")


def test_resize_applies_the_sources_exif_orientation(session: Session, tmp_path: Path) -> None:
    """A phone photo is stored sideways; the box bounds how it displays."""
    context = _context(session, tmp_path)
    source = _write_bytes(context, "photo.jpg", _rotated_photo((400, 200)))
    node = ImageResizeNode(ImageResizeConfig(max_width=100, max_height=100))

    items = _run(node, [_image_item(source, media_type="image/jpeg")], context)

    assert items[0].image is not None
    assert (items[0].image.width, items[0].image.height) == (50, 100)
    assert _stored_size(context, items[0]) == (50, 100)


def test_tile_cuts_the_grid_on_the_oriented_axes(session: Session, tmp_path: Path) -> None:
    """Tiling a sideways photo on its stored axes cuts the wrong edges."""
    context = _context(session, tmp_path)
    source = _write_bytes(context, "photo.jpg", _rotated_photo((2048, 512)))
    node = ImageTileNode(ImageTileConfig(tile_width=512, tile_height=512))

    items = _run(node, [_image_item(source, media_type="image/jpeg")], context)

    assert _sizes(items) == [(512, 512)] * 4
    assert [item.metadata.data["tile_row"] for item in items] == [0, 1, 2, 3]
    assert items[0].metadata.data["tile_rows"] == 4
    assert items[0].metadata.data["tile_columns"] == 1


def test_resize_keeps_the_colours_of_a_palette_image(session: Session, tmp_path: Path) -> None:
    """Pillow resamples palette images nearest-neighbour, flattening a scan."""
    context = _context(session, tmp_path)
    source = _write_bytes(context, "scan.png", _palette_checkerboard((400, 400)))
    node = ImageResizeNode(ImageResizeConfig(max_width=100, max_height=100))

    items = _run(node, [_image_item(source)], context)

    assert items[0].image is not None
    with Image.open(io.BytesIO(context.storage.read_bytes(items[0].image.path))) as stored:
        colours = stored.convert("RGB").getcolors(maxcolors=1 << 16) or []
    assert len(colours) >= 4


def test_resize_reports_the_frames_an_animation_lost(session: Session, tmp_path: Path) -> None:
    """Only the first frame survives, and the trace names what went with it."""
    context = _context(session, tmp_path)
    source = _write_bytes(context, "loop.gif", _animation((400, 200), frames=4))
    node = ImageResizeNode(ImageResizeConfig(max_width=100, max_height=100))
    inputs = {"items": ItemBatch(items=[_image_item(source, media_type="image/gif")])}

    outputs = node.run(inputs, context)

    items = ItemBatch.model_validate(outputs["items"]).items
    assert items[0].image is not None
    with Image.open(io.BytesIO(context.storage.read_bytes(items[0].image.path))) as stored:
        assert getattr(stored, "n_frames", 1) == 1
    warnings = next(
        value for value in node.summarize_io(inputs, outputs).outputs if value.label == "Warnings"
    )
    assert "4 frames" in str(warnings.value)


def test_tile_splits_a_grid_with_overlap_and_clips_the_edges(
    session: Session, tmp_path: Path
) -> None:
    """Stride is tile size minus overlap; the last row and column are clipped."""
    context = _context(session, tmp_path)
    source = _write_image(context, "wide.png", (2500, 1200))
    node = ImageTileNode(ImageTileConfig(tile_width=1024, tile_height=1024, overlap=100))

    items = _run(node, [_image_item(source)], context)

    assert _sizes(items) == [
        (1024, 1024),
        (1024, 1024),
        (652, 1024),
        (1024, 276),
        (1024, 276),
        (652, 276),
    ]
    assert _stored_size(context, items[2]) == (652, 1024)
    assert node.stats() == {
        "sources": 1,
        "tiles": 6,
        "unchanged": 0,
        "unreadable": 0,
        "grid": "3x2",
    }


def test_tile_ids_order_and_placement_travel_with_each_tile(
    session: Session, tmp_path: Path
) -> None:
    context = _context(session, tmp_path)
    source = _write_image(context, "spread.png", (2048, 1024))

    items = _run(ImageTileNode(ImageTileConfig()), [_image_item(source)], context)

    assert [item.id for item in items] == ["doc-1:page:0:tile:0", "doc-1:page:0:tile:1"]
    assert [item.order for item in items] == [0, 1]
    assert items[1].metadata.data == {
        "filename": "doc.pdf",
        "page": 1,
        "tile_index": 1,
        "tile_row": 0,
        "tile_column": 1,
        "tile_rows": 1,
        "tile_columns": 2,
    }
    assert items[1].image is not None
    assert items[1].image.path.endswith("spread-t1.png")


def test_tile_carries_the_source_items_other_facets_onto_every_tile(
    session: Session, tmp_path: Path
) -> None:
    """The output port preserves, so a transcription upstream must survive tiling."""
    context = _context(session, tmp_path)
    source = _write_image(context, "spread.png", (2048, 1024))
    item = _image_item(source).model_copy(
        update={
            "text": "page 1 transcription",
            "text_affixes": TextAffixes(prefix="From doc.pdf: ", suffix=""),
            "embedding": [0.5, 0.25],
            "score": 0.75,
        }
    )

    items = _run(ImageTileNode(ImageTileConfig()), [item], context)

    assert [tile.text for tile in items] == ["page 1 transcription"] * 2
    assert [tile.embedding for tile in items] == [[0.5, 0.25]] * 2
    assert [tile.score for tile in items] == [0.75] * 2
    assert [tile.text_affixes for tile in items] == [item.text_affixes] * 2


def test_tiles_of_one_document_are_numbered_without_colliding(
    session: Session, tmp_path: Path
) -> None:
    """`order` becomes chunk_index, so page 2's tiles cannot restart at zero."""
    context = _context(session, tmp_path)
    pages = [
        _image_item(_write_image(context, f"page{index}.png", (2048, 1024))).model_copy(
            update={"id": f"doc-1:page:{index}", "order": index}
        )
        for index in range(3)
    ]

    items = _run(ImageTileNode(ImageTileConfig()), pages, context)

    assert [item.order for item in items] == [0, 1, 2, 3, 4, 5]
    assert [item.id for item in items] == [
        f"doc-1:page:{page}:tile:{tile}" for page in range(3) for tile in range(2)
    ]


def test_an_image_that_fits_one_tile_is_renumbered_beside_the_tiles_of_its_document(
    session: Session, tmp_path: Path
) -> None:
    """Once a page becomes several items, every later index shifts with it."""
    context = _context(session, tmp_path)
    small = _image_item(_write_image(context, "page0.png", (512, 512))).model_copy(
        update={"id": "doc-1:page:0", "order": 0}
    )
    wide = _image_item(_write_image(context, "page1.png", (2048, 1024))).model_copy(
        update={"id": "doc-1:page:1", "order": 1}
    )

    items = _run(ImageTileNode(ImageTileConfig()), [small, wide], context)

    assert [item.order for item in items] == [0, 1, 2]
    assert [item.id for item in items] == [
        "doc-1:page:0",
        "doc-1:page:1:tile:0",
        "doc-1:page:1:tile:1",
    ]


def test_tile_emits_an_image_that_fits_in_one_tile_unchanged(
    session: Session, tmp_path: Path
) -> None:
    context = _context(session, tmp_path)
    relative = "collections/c/files/diagram.png"
    context.storage.write_bytes((ASSETS / "diagram.png").read_bytes(), relative)
    item = _image_item(relative)
    node = ImageTileNode(ImageTileConfig())

    items = _run(node, [item], context)

    assert items == [item]
    assert not (tmp_path / context.storage.derived_dir(context.collection.id, "doc-1")).exists()
    assert node.stats() == {"sources": 0, "tiles": 0, "unchanged": 1, "unreadable": 0}


def test_tile_passes_an_unreadable_image_through_with_a_warning(
    session: Session, tmp_path: Path
) -> None:
    """An asset that will not decode is counted apart from one that fitted."""
    context = _context(session, tmp_path)
    item = _image_item(_write_bytes(context, "broken.png", b"not an image"))
    node = ImageTileNode(ImageTileConfig())
    inputs = {"items": ItemBatch(items=[item])}

    outputs = node.run(inputs, context)

    assert ItemBatch.model_validate(outputs["items"]).items == [item]
    assert node.stats() == {"sources": 0, "tiles": 0, "unchanged": 0, "unreadable": 1}
    warnings = next(
        value for value in node.summarize_io(inputs, outputs).outputs if value.label == "Warnings"
    )
    assert "doc-1:page:0" in str(warnings.value)


def test_tile_reports_the_grid_of_the_one_image_it_split(
    session: Session, tmp_path: Path
) -> None:
    """Two images have no shared grid, so the run reports none."""
    context = _context(session, tmp_path)
    pages = [
        _image_item(_write_image(context, f"page{index}.png", (2048, 1024))).model_copy(
            update={"id": f"doc-1:page:{index}", "order": index}
        )
        for index in range(2)
    ]
    node = ImageTileNode(ImageTileConfig())

    _run(node, pages, context)

    assert node.stats() == {"sources": 2, "tiles": 4, "unchanged": 0, "unreadable": 0}


def test_tile_refuses_a_grid_above_the_tile_cap(session: Session, tmp_path: Path) -> None:
    """Each tile is encoded and written, so a mistyped size must not run."""
    context = _context(session, tmp_path)
    item = _image_item(_write_image(context, "poster.png", (1200, 1200)))
    node = ImageTileNode(ImageTileConfig(tile_width=64, tile_height=64))
    inputs = {"items": ItemBatch(items=[item])}

    outputs = node.run(inputs, context)

    assert ItemBatch.model_validate(outputs["items"]).items == [item]
    assert not (tmp_path / context.storage.derived_dir(context.collection.id, "doc-1")).exists()
    assert node.stats() == {"sources": 0, "tiles": 0, "unchanged": 1, "unreadable": 0}
    warnings = next(
        value for value in node.summarize_io(inputs, outputs).outputs if value.label == "Warnings"
    )
    assert "19x19" in str(warnings.value)


def test_tile_passes_non_image_items_through_after_the_tiles(
    session: Session, tmp_path: Path
) -> None:
    """Tiling changes the item count, so the merge has no positions to restore."""
    context = _context(session, tmp_path)
    source = _write_image(context, "page0.png", (2048, 1024))
    text = Item(id="doc-1:text", text="a paragraph", document_id="doc-1", order=7)

    items = _run(ImageTileNode(ImageTileConfig()), [text, _image_item(source)], context)

    assert [item.id for item in items] == [
        "doc-1:page:0:tile:0",
        "doc-1:page:0:tile:1",
        "doc-1:text",
    ]
    assert items[2] == text


def test_tile_rejects_an_overlap_above_half_the_tile_width() -> None:
    """Past half the tile, most of a tile repeats its neighbour."""
    with pytest.raises(ValidationError, match="half the tile width"):
        ImageTileConfig(tile_width=512, tile_height=2048, overlap=257)


def test_tile_rejects_an_overlap_above_half_the_tile_height() -> None:
    """The height is checked on its own: a wide tile does not excuse a short one."""
    with pytest.raises(ValidationError, match="half the tile height"):
        ImageTileConfig(tile_width=2048, tile_height=512, overlap=1024)


def test_tile_rejects_a_tile_smaller_than_a_readable_crop() -> None:
    """A mistyped tile size is what turns one page into thousands of crops."""
    with pytest.raises(ValidationError):
        ImageTileConfig(tile_width=10, tile_height=1024)


def test_a_transform_passes_non_image_items_through_in_place(
    session: Session, tmp_path: Path
) -> None:
    """A mixed stream keeps its order and its text items."""
    context = _context(session, tmp_path)
    source = _write_image(context, "page0.png", (3000, 2000))
    text = Item(id="doc-1:0", text="a paragraph", document_id="doc-1")

    items = _run(ImageResizeNode(ImageResizeConfig()), [text, _image_item(source)], context)

    assert items[0] == text
    assert items[1].image is not None
    assert (items[1].image.width, items[1].image.height) == (1568, 1045)


def test_the_trace_reports_the_streams_the_counters_and_what_was_skipped(
    session: Session, tmp_path: Path
) -> None:
    """One image summary shape on both sides, so the viewer renders one card."""
    context = _context(session, tmp_path)
    source = _write_image(context, "page0.png", (3000, 2000))
    node = ImageResizeNode(ImageResizeConfig())
    text = Item(id="doc-1:0", text="a paragraph", document_id="doc-1")
    inputs = {"items": ItemBatch(items=[text, _image_item(source)])}

    summary = node.summarize_io(inputs, node.run(inputs, context))

    assert [value.label for value in summary.inputs] == ["Images", "Passed through"]
    assert summary.inputs[1].value == {"count": 1, "facets": {"text": 1}}
    assert [value.label for value in summary.outputs] == ["Items", "Output items", "Resized"]
    assert summary.outputs[0].value == {
        "count": 1,
        "media_types": ["image/png"],
        "dimensions": ["1568x1045"],
    }
    assert summary.outputs[2].value == {"resized": 1, "unchanged": 0, "unreadable": 0}
