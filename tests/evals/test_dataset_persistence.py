"""Persisting a media-carrying triple, and cleaning up after one.

The dataset row records what its records carry; the media tree is addressed by
the dataset id, so nothing else can find those bytes once the row is gone.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.db import models
from app.evals.datasets.base import CorpusDoc, DatasetTriple, Qrel, QueryRecord
from app.evals.datasets.media import DatasetMediaStore
from app.evals.service import EvalService
from app.schemas.enums import EvalDatasetSource, EvalDatasetStatus, EvalModality
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage
from tests.evals.hf_fixtures import IMAGE_BYTES

CORPUS = '{"_id": "d1", "title": "T", "text": "alpha"}\n'
QUERIES = '{"_id": "q1", "text": "what is alpha"}\n'
QRELS = "q1\td1\t1\n"


@pytest.fixture(name="storage_root")
def storage_root_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point every `FileStorage()` these tests drive at a temp root.

    The media tree is asserted on directly, so it has to hold only what this
    test wrote — the suite's shared storage root holds every other test's.
    """
    monkeypatch.setenv("FILE_STORAGE_PATH", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _user(session: Session, email: str = "media@example.com") -> models.User:
    user = models.User(email=email, full_name="M", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _dataset_row(session: Session, user: models.User) -> models.EvalDataset:
    dataset = models.EvalDataset(
        user_id=user.id,
        name="Pages",
        source=EvalDatasetSource.BUILTIN_BENCHMARK.value,
        status=EvalDatasetStatus.DOWNLOADING.value,
    )
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset


def _image_triple(store: DatasetMediaStore) -> DatasetTriple:
    """A one-page image corpus with one text query asking about it."""
    asset = store.write("docs", "page-1", content_type="image/png", data=IMAGE_BYTES)
    return DatasetTriple(
        name="Pages",
        corpus=[CorpusDoc(external_doc_id="page-1", media=asset, metadata={"doc-id": "report"})],
        queries=[QueryRecord(external_query_id="q1", text="what does page one show")],
        qrels=[Qrel(query_external_id="q1", doc_external_id="page-1")],
    )


def test_persisted_media_survives_a_fresh_read(session: Session, storage_root: Path) -> None:
    """The stored asset reference is what a run later materializes from."""
    user = _user(session)
    dataset = _dataset_row(session, user)
    store = DatasetMediaStore(FileStorage(), dataset.id)

    EvalService(session).persist_triple(dataset, _image_triple(store))

    with Session(session.get_bind()) as fresh:
        document = fresh.exec(
            select(models.EvalDatasetDocument).where(
                models.EvalDatasetDocument.dataset_id == dataset.id
            )
        ).one()
        assert document.text is None
        assert document.media is not None
        assert document.media["media_type"] == "image/png"
        assert (storage_root / document.media["path"]).read_bytes() == IMAGE_BYTES


def test_dataset_modalities_come_from_the_records(session: Session, storage_root: Path) -> None:
    """The catalog reads modalities off the row rather than loading a corpus."""
    user = _user(session)
    dataset = _dataset_row(session, user)
    store = DatasetMediaStore(FileStorage(), dataset.id)

    EvalService(session).persist_triple(dataset, _image_triple(store))

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalDataset, dataset.id)
        assert stored is not None
        assert sorted(stored.modalities) == [EvalModality.IMAGE.value, EvalModality.TEXT.value]


def test_a_text_only_upload_records_the_text_modality(session: Session, storage_root: Path) -> None:
    """An uploaded BEIR dataset stays text, with no media column written."""
    user = _user(session)

    dataset = EvalService(session).upload_dataset(
        user, name="Golden", corpus=CORPUS, queries=QUERIES, qrels=QRELS
    )

    with Session(session.get_bind()) as fresh:
        stored = fresh.get(models.EvalDataset, dataset.id)
        assert stored is not None
        assert stored.modalities == [EvalModality.TEXT.value]
        document = fresh.exec(
            select(models.EvalDatasetDocument).where(
                models.EvalDatasetDocument.dataset_id == dataset.id
            )
        ).one()
        assert document.media is None


def test_a_rejected_upload_leaves_neither_a_row_nor_bytes(
    session: Session, storage_root: Path
) -> None:
    """A parse failure must not leave a dataset the user can see or delete.

    The id is minted before the parse so media has a root; without the purge
    that root outlives the upload that was refused.
    """
    user = _user(session)

    with pytest.raises(InvalidInputError):
        EvalService(session).upload_dataset(
            user, name="Bad", corpus="{not json", queries=QUERIES, qrels=QRELS
        )

    with Session(session.get_bind()) as fresh:
        assert (
            fresh.exec(
                select(models.EvalDataset).where(models.EvalDataset.user_id == user.id)
            ).all()
            == []
        )
    assert not (storage_root / "eval_datasets").exists()


def test_deleting_a_dataset_purges_its_media_tree(session: Session, storage_root: Path) -> None:
    """Rows and bytes go together — nothing else addresses the tree."""
    user = _user(session)
    dataset = _dataset_row(session, user)
    store = DatasetMediaStore(FileStorage(), dataset.id)
    EvalService(session).persist_triple(dataset, _image_triple(store))
    tree = storage_root / "eval_datasets" / str(dataset.id)
    assert tree.exists()

    EvalService(session).delete_dataset(user, dataset.id)

    assert not tree.exists()
