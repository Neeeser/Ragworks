"""Behavior of the three LLM node shells against a stubbed chat provider."""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

import httpx
import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.nodes.llm_generate import LlmGenerateConfig, LlmGenerateNode
from app.pipelines.nodes.llm_rerank import LlmRerankConfig, LlmRerankNode
from app.pipelines.nodes.llm_transform import LlmTransformNode
from app.pipelines.payloads import Item, ItemBatch
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubChatProvider,
    StubProviderResolver,
    StubVectorStoreProvider,
)

CONNECTION_ID = uuid4()


@pytest.fixture(autouse=True)
def _no_real_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    """Retry backoff must never wait out real time in these tests."""
    monkeypatch.setattr("app.pipelines.llm.throttle.time.sleep", lambda _: None)


def _context(
    session: Session,
    *,
    chat: StubChatProvider,
    ingestion: bool = False,
    query: str | None = "what is x?",
) -> PipelineRunContext:
    user = models.User(id=uuid4(), email="llm@test.local", hashed_password="hashed")
    collection = models.Collection(
        id=uuid4(), user_id=user.id, name="C", description="", extra_metadata={}
    )
    document = None
    if ingestion:
        document = models.Document(
            id=uuid4(),
            collection_id=collection.id,
            user_id=user.id,
            filename="doc.txt",
            content_type="text/plain",
            status="processing",
        )
    return PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=document,
        query=None if ingestion else query,
        top_k=None,
        providers=StubProviderResolver(chat_provider=chat),
        vector_stores=StubVectorStoreProvider(),
        storage=FileStorage(),
        settings=get_settings(),
    )


def _content(payload: dict[str, Any]) -> dict[str, Any]:
    return {"role": "assistant", "content": json.dumps(payload)}


def _rate_limited() -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://provider.test/chat")
    response = httpx.Response(429, request=request)
    return httpx.HTTPStatusError("rate limited", request=request, response=response)


def _transform_config(**overrides: Any) -> LlmNodeConfig:
    base: dict[str, Any] = {
        "connection_id": CONNECTION_ID,
        "model_name": "stub-model",
        "prompt": "Extract from: {text}",
        "output_fields": [
            {
                "name": "topic",
                "type": "string",
                "description": "topic",
                "target": {"kind": "metadata", "key": "topic"},
            }
        ],
    }
    base.update(overrides)
    return LlmNodeConfig.model_validate(base)


def _batch(*texts: str) -> ItemBatch:
    return ItemBatch(
        items=[Item(id=f"d1:{i}", text=text, document_id="d1", order=i) for i, text in enumerate(texts)]
    )


class TestTransform:
    def test_writes_metadata_per_item(self, session: Session) -> None:
        chat = StubChatProvider(
            responses=[_content({"topic": "alpha"}), _content({"topic": "beta"})]
        )
        node = LlmTransformNode(_transform_config())
        context = _context(session, chat=chat, ingestion=True)
        outputs = node.run({"items": _batch("one", "two")}, context)
        batch = ItemBatch.model_validate(outputs["items"])
        assert [item.metadata.data["topic"] for item in batch.items] == ["alpha", "beta"]
        # usage accumulated across both calls
        assert batch.usage.total_tokens == 30

    def test_prepends_context_with_document_text(self, session: Session) -> None:
        chat = StubChatProvider(responses=[_content({"ctx": "From chapter 2."})])
        config = _transform_config(
            prompt="<doc>{document_text}</doc> <chunk>{text}</chunk>",
            output_fields=[
                {
                    "name": "ctx",
                    "type": "string",
                    "description": "situating context",
                    "target": {"kind": "text", "mode": "prepend", "separator": "\n\n"},
                }
            ],
        )
        node = LlmTransformNode(config)
        context = _context(session, chat=chat, ingestion=True)
        from app.pipelines.payloads import ParsedDocumentPayload
        from app.retrieval.models import Document

        outputs = node.run(
            {
                "items": _batch("chunk body"),
                "document": ParsedDocumentPayload(
                    document=Document(document_id="d1", text="whole document")
                ),
            },
            context,
        )
        batch = ItemBatch.model_validate(outputs["items"])
        assert batch.items[0].text == "From chapter 2.\n\nchunk body"
        assert "whole document" in chat.requests[0].messages[-1]["content"]

    def test_ingestion_is_strict_after_retries(self, session: Session) -> None:
        chat = StubChatProvider(responses=[_rate_limited() for _ in range(5)])
        node = LlmTransformNode(_transform_config())
        context = _context(session, chat=chat, ingestion=True)
        with pytest.raises(httpx.HTTPStatusError):
            node.run({"items": _batch("one")}, context)

    def test_query_time_degrades_with_warning(self, session: Session) -> None:
        chat = StubChatProvider(responses=[_rate_limited() for _ in range(5)])
        node = LlmTransformNode(_transform_config())
        context = _context(session, chat=chat, ingestion=False)
        outputs = node.run({"items": _batch("one")}, context)
        batch = ItemBatch.model_validate(outputs["items"])
        assert batch.items[0].metadata.data == {}  # untouched pass-through
        summary = node.summarize_io({"items": _batch("one")}, outputs)
        warnings = [v for v in summary.outputs if v.label == "Warnings"]
        assert warnings
        assert "failed after retries" in str(warnings[0].value)

    def test_forced_tool_call_when_model_lacks_response_format(
        self, session: Session
    ) -> None:
        from app.schemas.models import ChatCapabilities, ModelInfo

        info = ModelInfo(
            id="stub-model",
            name="Stub",
            supported_parameters=["temperature"],
            capabilities=ChatCapabilities(tools=True),
        )
        chat = StubChatProvider(
            responses=[
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "function": {
                                "name": "emit_structured_output",
                                "arguments": json.dumps({"topic": "alpha"}),
                            },
                        }
                    ],
                }
            ],
            model_info=info,
        )
        node = LlmTransformNode(_transform_config())
        context = _context(session, chat=chat, ingestion=True)
        outputs = node.run({"items": _batch("one")}, context)
        batch = ItemBatch.model_validate(outputs["items"])
        assert batch.items[0].metadata.data["topic"] == "alpha"
        request = chat.requests[0]
        assert request.tools is not None
        assert request.parameters["tool_choice"]["function"]["name"] == "emit_structured_output"


def _rerank_config(**overrides: Any) -> LlmRerankConfig:
    base: dict[str, Any] = {
        "connection_id": CONNECTION_ID,
        "model_name": "stub-model",
        "prompt": "Query: {query}\n{items}",
        "output_fields": [
            {
                "name": "score",
                "type": "number",
                "description": "relevance",
                "target": {"kind": "score"},
            }
        ],
    }
    base.update(overrides)
    return LlmRerankConfig.model_validate(base)


class TestRerank:
    def test_reorders_by_scores_from_one_listwise_call(self, session: Session) -> None:
        chat = StubChatProvider(
            responses=[
                _content(
                    {
                        "results": [
                            {"index": 1, "score": 0.2},
                            {"index": 2, "score": 0.9},
                        ]
                    }
                )
            ]
        )
        node = LlmRerankNode(_rerank_config())
        outputs = node.run({"items": _batch("first", "second")}, _context(session, chat=chat))
        batch = ItemBatch.model_validate(outputs["items"])
        assert [item.id for item in batch.items] == ["d1:1", "d1:0"]
        assert batch.items[0].score == 0.9
        assert len(chat.requests) == 1  # listwise: one call for the whole batch
        assert "[1] first" in chat.requests[0].messages[-1]["content"]

    def test_judge_threshold_drops_weak_items(self, session: Session) -> None:
        chat = StubChatProvider(
            responses=[
                _content(
                    {
                        "results": [
                            {"index": 1, "score": 0.9},
                            {"index": 2, "score": 0.1},
                        ]
                    }
                )
            ]
        )
        node = LlmRerankNode(_rerank_config(drop_below=0.5))
        outputs = node.run({"items": _batch("keep", "drop")}, _context(session, chat=chat))
        batch = ItemBatch.model_validate(outputs["items"])
        assert [item.id for item in batch.items] == ["d1:0"]

    def test_degrades_to_original_order_at_query_time(self, session: Session) -> None:
        chat = StubChatProvider(responses=[_rate_limited() for _ in range(5)])
        node = LlmRerankNode(_rerank_config())
        outputs = node.run({"items": _batch("a", "b")}, _context(session, chat=chat))
        batch = ItemBatch.model_validate(outputs["items"])
        assert [item.id for item in batch.items] == ["d1:0", "d1:1"]

    def test_missing_result_entries_keep_items(self, session: Session) -> None:
        chat = StubChatProvider(
            responses=[_content({"results": [{"index": 2, "score": 0.8}]})]
        )
        node = LlmRerankNode(_rerank_config())
        outputs = node.run({"items": _batch("a", "b")}, _context(session, chat=chat))
        batch = ItemBatch.model_validate(outputs["items"])
        assert {item.id for item in batch.items} == {"d1:0", "d1:1"}
        assert batch.items[0].id == "d1:1"  # scored item first


def _generate_config(**overrides: Any) -> LlmGenerateConfig:
    base: dict[str, Any] = {
        "connection_id": CONNECTION_ID,
        "model_name": "stub-model",
        "prompt": "Rewrite: {text}",
        "output_fields": [
            {
                "name": "queries",
                "type": "string_list",
                "description": "rewrites",
                "target": {"kind": "items"},
            }
        ],
    }
    base.update(overrides)
    return LlmGenerateConfig.model_validate(base)


class TestGenerate:
    def test_emits_new_items_per_generated_string(self, session: Session) -> None:
        chat = StubChatProvider(responses=[_content({"queries": ["r1", "r2"]})])
        node = LlmGenerateNode(_generate_config())
        outputs = node.run(
            {"items": ItemBatch(items=[Item(id="query", text="original")])},
            _context(session, chat=chat),
        )
        batch = ItemBatch.model_validate(outputs["items"])
        assert [(item.id, item.text) for item in batch.items] == [
            ("query:llm1", "r1"),
            ("query:llm2", "r2"),
        ]

    def test_include_original_passes_source_through_first(self, session: Session) -> None:
        chat = StubChatProvider(responses=[_content({"queries": ["r1"]})])
        node = LlmGenerateNode(_generate_config(include_original=True))
        outputs = node.run(
            {"items": ItemBatch(items=[Item(id="query", text="original")])},
            _context(session, chat=chat),
        )
        batch = ItemBatch.model_validate(outputs["items"])
        assert [(item.id, item.text) for item in batch.items] == [
            ("query", "original"),
            ("query:llm1", "r1"),
        ]

    def test_degrades_to_source_item_at_query_time(self, session: Session) -> None:
        chat = StubChatProvider(responses=[_rate_limited() for _ in range(5)])
        node = LlmGenerateNode(_generate_config())
        outputs = node.run(
            {"items": ItemBatch(items=[Item(id="query", text="original")])},
            _context(session, chat=chat),
        )
        batch = ItemBatch.model_validate(outputs["items"])
        assert [(item.id, item.text) for item in batch.items] == [("query", "original")]
