"""Materializing a media-carrying corpus into an eval collection.

An image corpus document has to reach the collection as an image: written
under its own content type, from its own bytes. Materialized as text it would
ingest a UTF-8 rendering of nothing and score every query against it.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.db import models
from app.evals.datasets.media import DatasetMediaStore
from app.evals.provisioning import EvalProvisioner, ProvisionSpec
from app.schemas.enums import EvalDatasetSource, EvalDatasetStatus
from app.utils.file_storage import FileStorage
from tests.evals.hf_fixtures import IMAGE_BYTES
from tests.utils.providers import install_scaffolded_pipelines


class _StubProviderResolver:
    """Provider stand-in; an image the parse nodes decline never reaches it."""

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        pass

    def embedder(self, _connection_id: object, model_name: str, dimensions: object = None):
        raise AssertionError("A declined image reached the embedder.")

    def embedding_input_limit(self, _connection_id: object, _model_name: str) -> int | None:
        return None


@pytest.fixture(name="storage_root")
def storage_root_fixture(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point `FileStorage()` at a temp root so stored bytes are readable here."""
    monkeypatch.setenv("FILE_STORAGE_PATH", str(tmp_path))
    get_settings.cache_clear()
    monkeypatch.setattr("app.services.ingestion.ProviderResolver", _StubProviderResolver)
    yield tmp_path
    get_settings.cache_clear()


def _user(session: Session) -> models.User:
    user = models.User(email="pages@example.com", full_name="P", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    install_scaffolded_pipelines(session, user)
    return user


def _image_corpus(
    session: Session, user: models.User
) -> tuple[models.EvalDataset, models.EvalDatasetDocument]:
    dataset = models.EvalDataset(
        user_id=user.id,
        name="Pages",
        source=EvalDatasetSource.BUILTIN_BENCHMARK.value,
        status=EvalDatasetStatus.READY.value,
        modalities=["image"],
    )
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    asset = DatasetMediaStore(FileStorage(), dataset.id).write(
        "docs", "page-1", content_type="image/png", data=IMAGE_BYTES
    )
    document = models.EvalDatasetDocument(
        dataset_id=dataset.id,
        external_doc_id="page-1",
        media=asset.model_dump(mode="json"),
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return dataset, document


def _spec(session: Session, user: models.User, dataset: models.EvalDataset) -> ProvisionSpec:
    ingestion = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == "default-ingest",
        )
    ).one()
    retrieval = session.exec(
        select(models.Pipeline).where(
            models.Pipeline.user_id == user.id,
            models.Pipeline.template_slug == "default-search",
        )
    ).one()
    return ProvisionSpec(
        dataset=dataset,
        cache_key="imagekey",
        ingestion_pipeline=ingestion,
        retrieval_pipeline=retrieval,
    )


def test_an_image_corpus_doc_materializes_as_its_own_media(
    session: Session, storage_root: Path
) -> None:
    """The file carries the image content type and the original bytes."""
    user = _user(session)
    dataset, document = _image_corpus(session, user)

    result = EvalProvisioner(session).provision(
        user=user, spec=_spec(session, user, dataset), corpus_docs=[document]
    )

    with Session(session.get_bind()) as fresh:
        node = fresh.exec(
            select(models.FileNode).where(models.FileNode.collection_id == result.collection.id)
        ).one()
        assert node.name == "page-1.png"
        assert node.content_type == "image/png"
        assert node.storage_path is not None
        assert Path(node.storage_path).read_bytes() == IMAGE_BYTES


def test_a_document_no_parse_node_reads_is_recorded_not_raised(
    session: Session, storage_root: Path
) -> None:
    """A text-only ingestion pipeline loses the page in the stage-0 funnel.

    That is the honest outcome of pointing an image dataset at a pipeline that
    cannot read one, and it must not take the whole run down with it.
    """
    user = _user(session)
    dataset, document = _image_corpus(session, user)

    result = EvalProvisioner(session).provision(
        user=user, spec=_spec(session, user, dataset), corpus_docs=[document]
    )

    assert result.failed_external_ids == {"page-1"}
    assert result.indexed_external_ids == set()


def test_reprovisioning_recognizes_the_media_file_it_already_wrote(
    session: Session, storage_root: Path
) -> None:
    """The reuse path matches stored file names, which now carry an extension.

    Matching on `.txt` alone would re-materialize every page on every run and
    leave the collection holding one duplicate per attempt.
    """
    user = _user(session)
    dataset, document = _image_corpus(session, user)
    provisioner = EvalProvisioner(session)
    spec = _spec(session, user, dataset)
    provisioner.provision(user=user, spec=spec, corpus_docs=[document])

    result = provisioner.provision(user=user, spec=spec, corpus_docs=[document])

    assert result.reused is True
    with Session(session.get_bind()) as fresh:
        nodes = fresh.exec(
            select(models.FileNode).where(models.FileNode.collection_id == result.collection.id)
        ).all()
        assert [node.name for node in nodes] == ["page-1.png"]
