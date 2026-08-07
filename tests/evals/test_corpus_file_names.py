"""Materialized corpus file names: the id/content-type round trip.

An eval collection recovers a document's benchmark id from its file name, so
the extension a document is written under has to be one the reader strips
back off — otherwise an image corpus scores every retrieval against ids that
still carry `.png`.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.db import models
from app.evals.corpus_documents import (
    external_id_from_name,
    file_name_for,
    file_name_for_document,
)
from app.pipelines.payloads import MediaAsset
from app.schemas.content_types import KNOWN_CONTENT_TYPES
from app.services.errors import InvalidInputError

CONTENT_TYPES = [option.value for option in KNOWN_CONTENT_TYPES]


@pytest.mark.parametrize("content_type", CONTENT_TYPES)
@pytest.mark.parametrize("external_id", ["d1", "MED-10", "corpus/page/3", "report.pdf", "d.1"])
def test_the_name_round_trips_every_content_type(external_id: str, content_type: str) -> None:
    """The id survives the write/read pair for every type a corpus can carry."""
    name = file_name_for(external_id, content_type)
    assert external_id_from_name(name) == external_id.replace("/", "_")


def test_an_unknown_content_type_still_names_the_file() -> None:
    """A benchmark shipping an unlisted type imports rather than failing."""
    name = file_name_for("d1", "application/x-parquet")
    assert name == "d1.bin"
    assert external_id_from_name(name) == "d1"


def test_an_empty_external_id_is_rejected() -> None:
    """An unnamed document would overwrite whichever one was written last."""
    with pytest.raises(InvalidInputError):
        file_name_for("", "text/plain")


def test_a_media_document_is_named_by_its_media_type() -> None:
    """A page image is written as an image, not as a text file holding one."""
    document = models.EvalDatasetDocument(
        dataset_id=uuid4(),
        external_doc_id="42",
        media=MediaAsset(
            media_type="image/png", path="eval_datasets/x/docs/42.png", byte_size=10
        ).model_dump(mode="json"),
    )
    assert file_name_for_document(document) == "42.png"


def test_a_text_document_is_named_as_plain_text() -> None:
    """A document with no media keeps the text extension it always had."""
    document = models.EvalDatasetDocument(dataset_id=uuid4(), external_doc_id="42", text="alpha")
    assert file_name_for_document(document) == "42.txt"
