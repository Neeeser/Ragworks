"""Resolving a stream item's id to the stored chunk position it names."""

from __future__ import annotations

from uuid import uuid4

from app.services.traces import chunk_position


def test_a_text_chunk_id_resolves_to_its_document_and_index() -> None:
    document_id = uuid4()

    assert chunk_position(f"{document_id}:3") == (document_id, 3)


def test_a_bare_document_id_resolves_to_the_documents_single_chunk() -> None:
    """A standalone image becomes one chunk, so its item id carries no index.

    Requiring a `:index` suffix left every image search result unresolvable:
    the trace showed the raw id and claimed the chunk no longer existed, for
    a chunk the same query had just returned.
    """
    document_id = uuid4()

    assert chunk_position(str(document_id)) == (document_id, 0)


def test_a_kind_marked_image_id_resolves_to_its_trailing_index() -> None:
    """A PDF page image is named `{document}:img:{index}` by its parse node."""
    document_id = uuid4()

    assert chunk_position(f"{document_id}:img:1") == (document_id, 1)


def test_an_id_that_names_no_document_resolves_to_nothing() -> None:
    assert chunk_position("not-a-uuid:0") is None


def test_an_unparseable_index_resolves_to_nothing() -> None:
    document_id = uuid4()

    assert chunk_position(f"{document_id}:page-two") is None
