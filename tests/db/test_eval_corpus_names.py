"""The corpus file name, pinned across its Python and SQL forms.

`file_name_for_document` names the file the provisioner materializes;
`page_collection_documents` rebuilds that name in SQL to join a collection's
documents back to their corpus rows. Two expressions of one rule drift
silently, and the drift surfaces as an eval collection whose document browser
reports zero documents while the collection holds every one of them.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import EvalDatasetRepository
from app.evals.corpus_documents import file_name_for_document
from app.pipelines.payloads import MediaAsset
from app.schemas.content_types import KNOWN_CONTENT_TYPES

#: One corpus document per shape a materialized file can take: no media at
#: all, every catalog content type, and a type the catalog does not name.
_MEDIA: tuple[dict[str, object] | None, ...] = (
    None,
    *(
        MediaAsset(
            media_type=option.value, path=f"eval_datasets/x/docs/{option.value}", byte_size=4
        ).model_dump()
        for option in KNOWN_CONTENT_TYPES
    ),
    MediaAsset(media_type="audio/ogg", path="eval_datasets/x/docs/sound", byte_size=4).model_dump(),
)


@pytest.fixture(name="seeded")
def seeded_fixture(session: Session) -> tuple[models.EvalDataset, models.Collection]:
    """A dataset whose corpus documents are all materialized in a collection."""
    user = models.User(email="corpus@example.com", full_name="Corpus", hashed_password="hashed")
    session.add(user)
    session.commit()
    dataset = models.EvalDataset(
        user_id=user.id, name="Shapes", source="custom_upload", status="ready"
    )
    collection = models.Collection(user_id=user.id, name="Eval: shapes", system_purpose="eval")
    session.add(dataset)
    session.add(collection)
    session.commit()
    for index, media in enumerate(_MEDIA):
        corpus_doc = models.EvalDatasetDocument(
            dataset_id=dataset.id,
            external_doc_id=f"folder/d{index}",
            title=f"Doc {index}",
            text=None if media is not None else "body",
            media=media,
        )
        session.add(corpus_doc)
        session.add(
            models.Document(
                user_id=user.id,
                collection_id=collection.id,
                name=file_name_for_document(corpus_doc),
                content_type="text/plain",
                embedding_model="stub-embedder",
                status=models.DocumentStatus.READY,
                num_chunks=1,
            )
        )
    session.commit()
    return dataset, collection


def test_every_materialized_name_joins_back_to_its_corpus_row(
    session: Session, seeded: tuple[models.EvalDataset, models.Collection]
) -> None:
    """The SQL name matches what the provisioner wrote, for every media shape."""
    dataset, collection = seeded

    rows, total = EvalDatasetRepository(session).page_collection_documents(
        dataset.id, collection.id, search=None, offset=0, limit=100
    )

    assert total == len(_MEDIA)
    assert {external_id for _, external_id, _ in rows} == {
        f"folder/d{index}" for index in range(len(_MEDIA))
    }


def test_a_document_with_no_media_joins_as_text(
    session: Session, seeded: tuple[models.EvalDataset, models.Collection]
) -> None:
    """A media-less corpus row is a `.txt` file, not the unknown-type fallback.

    The JSON column stores a Python `None` as JSON `null`, so a SQL `IS NULL`
    test on the column answers false and names every text document `.bin`.
    """
    dataset, collection = seeded

    rows, _ = EvalDatasetRepository(session).page_collection_documents(
        dataset.id, collection.id, search="d0", offset=0, limit=10
    )

    assert [document.name for document, _, _ in rows] == ["folder_d0.txt"]
