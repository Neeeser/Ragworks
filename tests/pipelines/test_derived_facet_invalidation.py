"""Content rewrites clear the annotations derived from the old content.

A node that rewrites an item's text or image bytes leaves any `embedding`
or `score` describing content that no longer exists, so it clears both on
the items it rewrites and declares that with `removes` on its output port.
The two halves are tested together here because they must agree: a
declaration nothing enforces is what lets a stale vector reach an index.
"""

from __future__ import annotations

import io
from pathlib import Path
from uuid import uuid4

from PIL import Image
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.llm.config import MetadataTarget, OutputFieldSpec, ScoreTarget, TextTarget
from app.pipelines.llm.mapping import apply_annotations
from app.pipelines.nodes.chunking import TokenChunkerNode
from app.pipelines.nodes.image_transform import (
    ImageResizeConfig,
    ImageResizeNode,
    ImageTileConfig,
    ImageTileNode,
)
from app.pipelines.payloads import Item, ItemBatch, MediaAsset
from app.pipelines.ports import Facet
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import StubProviderResolver, StubVectorStoreProvider

#: A vector short enough to read in a failure message; width is irrelevant
#: here, only whether it survives a rewrite.
VECTOR = [0.1, 0.2, 0.3]

REWRITING_NODES = (TokenChunkerNode, ImageResizeNode, ImageTileNode)


def _context(session: Session, storage_path: Path) -> PipelineRunContext:
    user = models.User(id=uuid4(), email="invalidation@test.local", hashed_password="hashed")
    return PipelineRunContext(
        session=session,
        user=user,
        collection=models.Collection(
            id=uuid4(), user_id=user.id, name="Rewrites", description="", extra_metadata={}
        ),
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(None),
        storage=FileStorage(base_path=storage_path),
        settings=get_settings(),
    )


def _write_image(context: PipelineRunContext, name: str, size: tuple[int, int]) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(120, 40, 200)).save(buffer, format="PNG")
    relative = f"collections/c/derived/doc-1/{name}"
    context.storage.write_bytes(buffer.getvalue(), relative)
    return relative


def _embedded_image(path: str) -> Item:
    return Item(
        id="doc-1:page:0",
        image=MediaAsset(media_type="image/png", path=path, byte_size=1),
        document_id="doc-1",
        order=0,
        embedding=VECTOR,
        score=0.9,
    )


def _run(node: object, items: list[Item], context: PipelineRunContext) -> list[Item]:
    outputs = node.run({"items": ItemBatch(items=items)}, context)  # type: ignore[attr-defined]
    return ItemBatch.model_validate(outputs["items"]).items


def test_every_rewriting_node_declares_the_facets_it_destroys() -> None:
    """The declaration is what the editor and the requires check read."""
    for node_class in REWRITING_NODES:
        removes = frozenset(node_class.output_ports[0].removes)
        assert removes == frozenset({Facet.EMBEDDING, Facet.SCORE}), node_class.type


def test_resizing_an_image_drops_the_vector_computed_from_the_old_pixels(
    session: Session, tmp_path: Path
) -> None:
    context = _context(session, tmp_path)
    source = _write_image(context, "page0.png", (3000, 2000))

    items = _run(ImageResizeNode(ImageResizeConfig()), [_embedded_image(source)], context)

    assert len(items) == 1
    assert (items[0].image.width, items[0].image.height) == (1568, 1045)  # type: ignore[union-attr]
    assert items[0].embedding is None
    assert items[0].score is None


def test_an_image_already_inside_the_box_keeps_its_vector(
    session: Session, tmp_path: Path
) -> None:
    """Its bytes were not rewritten, so the vector still describes it."""
    context = _context(session, tmp_path)
    source = _write_image(context, "small.png", (800, 600))

    items = _run(ImageResizeNode(ImageResizeConfig()), [_embedded_image(source)], context)

    assert items[0].embedding == VECTOR
    assert items[0].score == 0.9


def test_an_item_the_transform_never_reads_keeps_its_vector(
    session: Session, tmp_path: Path
) -> None:
    """A text item rides through an image transform untouched."""
    context = _context(session, tmp_path)
    passed = Item(id="c1", text="body", embedding=VECTOR, score=0.5)

    items = _run(ImageResizeNode(ImageResizeConfig()), [passed], context)

    assert items[0].embedding == VECTOR
    assert items[0].score == 0.5


def test_tiles_carry_no_vector_from_the_image_they_were_cut_from(
    session: Session, tmp_path: Path
) -> None:
    context = _context(session, tmp_path)
    source = _write_image(context, "page0.png", (2048, 1024))

    items = _run(
        ImageTileNode(ImageTileConfig(tile_width=1024, tile_height=1024)),
        [_embedded_image(source)],
        context,
    )

    assert len(items) == 2
    assert [item.embedding for item in items] == [None, None]
    assert [item.score for item in items] == [None, None]


def test_chunks_carry_no_vector_from_the_text_they_were_split_from(
    session: Session, tmp_path: Path
) -> None:
    context = _context(session, tmp_path)
    embedded = Item(id="doc-1", text="one two three. " * 40, embedding=VECTOR, score=0.5)

    items = _run(TokenChunkerNode(TokenChunkerNode.config_model()), [embedded], context)

    assert items
    assert all(item.embedding is None for item in items)
    assert all(item.score is None for item in items)


def test_writing_an_item_s_text_drops_the_vector_computed_from_the_old_text() -> None:
    item = Item(id="c1", text="original", embedding=VECTOR, score=0.5)
    spec = OutputFieldSpec(
        name="context", type="string", target=TextTarget(mode="prepend", separator=" | ")
    )

    updated = apply_annotations(item, [spec], {"context": "situating"})

    assert updated.text == "situating | original"
    assert updated.embedding is None
    assert updated.score is None


def test_writing_only_metadata_keeps_the_vector() -> None:
    """The content the vector was computed from is untouched."""
    item = Item(id="c1", text="original", embedding=VECTOR, score=0.5)
    spec = OutputFieldSpec(name="author", type="string", target=MetadataTarget(key="author"))

    updated = apply_annotations(item, [spec], {"author": "Smith"})

    assert updated.text == "original"
    assert updated.embedding == VECTOR
    assert updated.score == 0.5


def test_a_score_the_node_itself_wrote_survives_its_own_write() -> None:
    """A rerank writes the score; clearing it would discard the node's output."""
    item = Item(id="c1", text="original", embedding=VECTOR, score=0.1)
    spec = OutputFieldSpec(name="relevance", type="number", target=ScoreTarget())

    updated = apply_annotations(item, [spec], {"relevance": 0.87})

    assert updated.score == 0.87
    assert updated.embedding == VECTOR
