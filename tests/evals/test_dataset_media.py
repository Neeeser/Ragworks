"""The eval dataset media store: paths, resume, dimensions, and purge.

Driven against a real PNG from `tests/assets/` because dimension measurement
is a decode, and synthetic bytes exercise none of it.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from app.evals.datasets.media import DatasetMediaStore
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage

PNG = (Path(__file__).parent.parent / "assets" / "diagram.png").read_bytes()
PNG_SIZE = (200, 120)


def _store(tmp_path: Path) -> tuple[DatasetMediaStore, str]:
    """Build a store over `tmp_path` and return it with its dataset id."""
    dataset_id = uuid4()
    return DatasetMediaStore(FileStorage(base_path=tmp_path), dataset_id), str(dataset_id)


def test_write_places_bytes_under_the_dataset_and_kind(tmp_path: Path) -> None:
    """The path names the dataset, the side of the triple, and the record."""
    store, dataset_id = _store(tmp_path)

    asset = store.write("docs", "d1", content_type="image/png", data=PNG)

    assert asset.path == f"eval_datasets/{dataset_id}/docs/d1.png"
    assert (tmp_path / asset.path).read_bytes() == PNG
    assert asset.byte_size == len(PNG)


def test_docs_and_queries_never_share_a_file(tmp_path: Path) -> None:
    """Colliding external ids across the two sides stay separate files."""
    store, _ = _store(tmp_path)

    doc = store.write("docs", "shared", content_type="image/png", data=PNG)
    query = store.write("queries", "shared", content_type="image/png", data=PNG[:-1])

    assert doc.path != query.path
    assert (tmp_path / doc.path).stat().st_size == len(PNG)


def test_external_id_path_separators_are_sanitized(tmp_path: Path) -> None:
    """A BEIR id containing `/` names a file, never a nested directory."""
    store, dataset_id = _store(tmp_path)

    asset = store.write("docs", "corpus/page/3", content_type="image/png", data=PNG)

    assert asset.path == f"eval_datasets/{dataset_id}/docs/corpus_page_3.png"


def test_empty_external_id_is_rejected(tmp_path: Path) -> None:
    """An unnamed record would overwrite whatever the last one wrote."""
    store, _ = _store(tmp_path)

    with pytest.raises(InvalidInputError):
        store.write("docs", "", content_type="image/png", data=PNG)


def test_unknown_content_type_still_names_the_file(tmp_path: Path) -> None:
    """A type the catalog does not list stores rather than failing the import."""
    store, dataset_id = _store(tmp_path)

    asset = store.write("docs", "d1", content_type="application/x-parquet", data=b"rows")

    assert asset.path == f"eval_datasets/{dataset_id}/docs/d1.bin"
    assert (tmp_path / asset.path).read_bytes() == b"rows"


def test_a_declared_content_type_is_normalized(tmp_path: Path) -> None:
    """A loader passes on the header it got, charset and case included.

    The stored media type travels to an upload and into provider requests,
    neither of which accepts a parameterized or upper-case type.
    """
    store, dataset_id = _store(tmp_path)

    asset = store.write(
        "queries", "q1", content_type="TEXT/PLAIN; charset=utf-8", data=b"what is alpha"
    )

    assert asset.media_type == "text/plain"
    assert asset.path == f"eval_datasets/{dataset_id}/queries/q1.txt"


def test_rewriting_the_same_size_is_skipped(tmp_path: Path) -> None:
    """A resumed import keeps what it already fetched instead of rewriting it."""
    store, _ = _store(tmp_path)
    asset = store.write("docs", "d1", content_type="image/png", data=PNG)
    stored = tmp_path / asset.path
    stored.write_bytes(b"S" * len(PNG))

    again = store.write("docs", "d1", content_type="image/png", data=PNG)

    assert again.path == asset.path
    assert stored.read_bytes() == b"S" * len(PNG)


def test_a_different_size_is_written_over(tmp_path: Path) -> None:
    """A truncated file from an interrupted write is replaced, not kept."""
    store, _ = _store(tmp_path)
    asset = store.write("docs", "d1", content_type="image/png", data=PNG)
    stored = tmp_path / asset.path
    stored.write_bytes(PNG[:100])

    store.write("docs", "d1", content_type="image/png", data=PNG)

    assert stored.read_bytes() == PNG


def test_image_dimensions_are_measured(tmp_path: Path) -> None:
    """A stored page image carries the size a match renders at."""
    store, _ = _store(tmp_path)

    asset = store.write("docs", "d1", content_type="image/png", data=PNG)

    assert (asset.width, asset.height) == PNG_SIZE


def test_non_image_media_has_no_dimensions(tmp_path: Path) -> None:
    """Nothing is decoded for a type that has no pixels."""
    store, _ = _store(tmp_path)

    asset = store.write("queries", "q1", content_type="text/plain", data=b"what is alpha")

    assert asset.width is None
    assert asset.height is None
    assert asset.media_type == "text/plain"


def test_unreadable_image_bytes_still_store(tmp_path: Path) -> None:
    """Dimensions are metadata: an undecodable image imports without them."""
    store, _ = _store(tmp_path)

    asset = store.write("docs", "d1", content_type="image/png", data=b"not a png")

    assert asset.width is None
    assert asset.height is None
    assert (tmp_path / asset.path).read_bytes() == b"not a png"


def test_purge_removes_every_file_the_dataset_stored(tmp_path: Path) -> None:
    """Deleting a dataset is one tree removal, including a partial import."""
    store, dataset_id = _store(tmp_path)
    store.write("docs", "d1", content_type="image/png", data=PNG)
    store.write("queries", "q1", content_type="image/png", data=PNG)
    other, other_id = _store(tmp_path)
    other.write("docs", "d1", content_type="image/png", data=PNG)

    store.purge()

    assert not (tmp_path / "eval_datasets" / dataset_id).exists()
    assert (tmp_path / "eval_datasets" / other_id / "docs" / "d1.png").exists()


def test_purge_of_a_dataset_that_stored_nothing_is_a_no_op(tmp_path: Path) -> None:
    """A rejected upload purges before anything was written."""
    store, _ = _store(tmp_path)

    store.purge()
