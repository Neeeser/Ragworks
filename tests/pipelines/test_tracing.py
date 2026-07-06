"""Shape-equality anchor: typed summaries must serialize exactly like the old dicts.

`nodes/trace_utils.py` used to return plain dicts that got embedded in
`NodeTraceValue.value` and persisted to `PipelineNodeRun.summary` /
`PipelineNodeIO.payload` -- the frontend reads those blobs directly. This
module replaces the dict-returning helpers with typed Pydantic models
(`app/pipelines/tracing/summaries.py`); every case below pins the exact JSON
shape the old dict-returning function produced for a representative input,
so the refactor can't quietly change the wire contract.

Serialization goes through `serialize_payload` (the same function
`PipelineTraceRecorder` calls) rather than `model_dump()` directly, so this
exercises the real code path -- including a summary model living inside a
`NodeTraceValue.value: object` field, same as every node's `summarize_io`.
"""

from __future__ import annotations

from app.pipelines.tracing.recorder import NodeTraceValue, serialize_payload
from app.pipelines.tracing.summaries import (
    TokenUsage,
    summarize_chunks,
    summarize_embeddings,
    summarize_match_order,
    summarize_matches,
    summarize_query_embedding,
    summarize_source,
    summarize_text,
)
from app.retrieval.models import DocumentChunk, DocumentMetadata, ScoredChunk
from app.retrieval.parsers.base import DocumentSource


def _serialized_value(summary: object) -> object:
    """Round-trip a summary through the same path PipelineTraceRecorder uses."""
    encoded = serialize_payload(NodeTraceValue(label="x", value=summary))
    assert isinstance(encoded, dict)
    return encoded["value"]


def test_source_summary_matches_old_dict_shape() -> None:
    source = DocumentSource(
        document_id="doc-1",
        path="/tmp/file.pdf",
        content_type="application/pdf",
    )

    assert _serialized_value(summarize_source(source)) == {
        "document_id": "doc-1",
        "path": "/tmp/file.pdf",
        "content_type": "application/pdf",
    }


def test_text_summary_matches_old_dict_shape_with_full_text() -> None:
    summary = summarize_text("short text", limit=10, full_limit=20)

    assert _serialized_value(summary) == {
        "preview": "short text",
        "length": 10,
        "full": "short text",
    }


def test_text_summary_matches_old_dict_shape_omitting_full_text() -> None:
    """The old dict omitted `full` entirely past `full_limit` -- not `full: null`."""
    summary = summarize_text("x" * 50, limit=10, full_limit=20)

    encoded = _serialized_value(summary)
    assert encoded == {"preview": "xxxxxxxxxx...", "length": 50}
    assert "full" not in encoded


def test_chunk_batch_summary_matches_old_dict_shape() -> None:
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="hello world",
        order=0,
        metadata=DocumentMetadata(),
    )

    assert _serialized_value(summarize_chunks([chunk])) == {
        "count": 1,
        "samples": [{"chunk_id": "doc:0", "order": 0, "preview": "hello world"}],
        "document_id": "doc",
    }


def test_chunk_batch_summary_matches_old_dict_shape_when_empty() -> None:
    """The old dict omitted `document_id` entirely for an empty batch."""
    encoded = _serialized_value(summarize_chunks([]))

    assert encoded == {"count": 0, "samples": []}
    assert "document_id" not in encoded


def test_embedding_summary_matches_old_dict_shape() -> None:
    embedded = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="hello",
        order=0,
        metadata=DocumentMetadata(),
        embedding=[0.1, 0.2, 0.3],
    )
    bare = DocumentChunk(
        document_id="doc",
        chunk_id="doc:1",
        text="world",
        order=1,
        metadata=DocumentMetadata(),
        embedding=None,
    )

    assert _serialized_value(summarize_embeddings([embedded, bare])) == {
        "count": 2,
        "dimension": 3,
        "samples": [
            {"chunk_id": "doc:0", "preview": {"preview": [0.1, 0.2, 0.3], "total_values": 3}},
            {"chunk_id": "doc:1", "preview": None},
        ],
    }


def test_query_embedding_summary_matches_old_dict_shape() -> None:
    assert _serialized_value(summarize_query_embedding([0.1, 0.2])) == {
        "preview": [0.1, 0.2],
        "total_values": 2,
    }
    assert _serialized_value(summarize_query_embedding(None)) == {
        "preview": [],
        "total_values": 0,
    }


def test_match_list_summary_matches_old_dict_shape() -> None:
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="alpha beta",
        order=0,
        metadata=DocumentMetadata(),
    )
    matches = [ScoredChunk(chunk=chunk, score=0.9)]

    assert _serialized_value(summarize_matches(matches)) == {
        "count": 1,
        "top_matches": [
            {
                "rank": 1,
                "chunk_id": "doc:0",
                "document_id": "doc",
                "score": 0.9,
                "preview": "alpha beta",
            }
        ],
    }


def test_match_order_summary_matches_old_bare_list_shape() -> None:
    """The old helper returned a bare list, not a dict -- so does this one."""
    chunk = DocumentChunk(
        document_id="doc",
        chunk_id="doc:0",
        text="alpha",
        order=0,
        metadata=DocumentMetadata(),
    )
    matches = [ScoredChunk(chunk=chunk, score=0.5)]

    assert _serialized_value(summarize_match_order(matches)) == [
        {"rank": 1, "chunk_id": "doc:0", "score": 0.5}
    ]


def test_token_usage_matches_old_dict_shape() -> None:
    assert _serialized_value(TokenUsage(prompt_tokens=3, total_tokens=5)) == {
        "prompt_tokens": 3,
        "total_tokens": 5,
    }
    assert _serialized_value(TokenUsage()) == {}
    assert _serialized_value(TokenUsage.model_validate({})) == {}


def test_node_trace_value_kind_accepts_only_known_literals() -> None:
    """`kind` narrowed from `str` to a closed Literal; valid values still work."""
    assert NodeTraceValue(label="x", value=1, kind="text").kind == "text"
    assert NodeTraceValue(label="x", value=1, kind="embedding").kind == "embedding"
    assert NodeTraceValue(label="x", value=1).kind == "json"
