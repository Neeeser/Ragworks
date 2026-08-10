"""An image result's stored picture reaches the persisted eval item.

An image chunk indexes under a derived `[image: …]` placeholder, so the
item row's chunk id and score say nothing about which picture came back —
the asset reference is what a reader judges an image-retrieval run on.
"""

from __future__ import annotations

from uuid import uuid4

from app.evals.execution.scoring import score_query
from app.pipelines.payloads import IMAGE_ASSET_METADATA_KEY
from app.schemas.evals import EvalRunConfig
from app.schemas.retrieval import CollectionQueryResponse, RetrievedChunk

ASSET = {
    "media_type": "image/png",
    "path": "collections/c1/derived/d1/page-12.png",
    "byte_size": 2048,
    "width": 640,
    "height": 480,
}


def _response(*chunks: RetrievedChunk) -> CollectionQueryResponse:
    return CollectionQueryResponse(query="q", top_k=5, chunks=list(chunks), usage={})


def _score(response: CollectionQueryResponse) -> list[dict[str, object]]:
    item, _ = score_query(
        run_id=uuid4(),
        query_external_id="q1",
        query_text="",
        gold={"d1": 1},
        config=EvalRunConfig(num_queries=1, distractor_pool_size=0),
        mapping={"doc-uuid": "d1"},
        indexed_external_ids={"d1"},
        response=response,
        node_runs=[],
    )
    return item.retrieved


def test_an_image_result_records_the_asset_it_stands_for() -> None:
    retrieved = _score(
        _response(
            RetrievedChunk(
                chunk_id="doc-uuid:0",
                document_id="doc-uuid",
                score=0.9,
                text="[image: page-12.png]",
                metadata={IMAGE_ASSET_METADATA_KEY: ASSET},
            )
        )
    )

    assert retrieved == [
        {"chunk_id": "doc-uuid:0", "document_id": "d1", "score": 0.9, "media": ASSET}
    ]


def test_a_text_result_records_no_media_key() -> None:
    """A text result keeps the shape a run recorded before the field."""
    retrieved = _score(
        _response(
            RetrievedChunk(
                chunk_id="doc-uuid:0",
                document_id="doc-uuid",
                score=0.5,
                text="alpha",
                metadata={},
            )
        )
    )

    assert retrieved == [{"chunk_id": "doc-uuid:0", "document_id": "d1", "score": 0.5}]
