from __future__ import annotations

from app.schemas.openrouter import (
    OpenRouterChatResponse,
    OpenRouterEmbeddingsResponse,
    OpenRouterRerankResponse,
    OpenRouterStreamChunk,
)


def test_openrouter_chat_response_preserves_extra_fields() -> None:
    payload = {
        "id": "resp-1",
        "provider": "openrouter",
        "choices": [
            {
                "index": 0,
                "message": {
                    "content": "Hello",
                    "extra_message": "detail",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 4,
            "total_tokens": 7,
            "unexpected_usage": "kept",
        },
        "extra_top": "preserve-me",
    }

    response = OpenRouterChatResponse.model_validate(payload)
    dumped = response.model_dump(exclude_none=True)

    assert dumped["provider"] == "openrouter"
    assert dumped["extra_top"] == "preserve-me"
    assert dumped["choices"][0]["message"]["extra_message"] == "detail"
    assert dumped["usage"]["unexpected_usage"] == "kept"


def test_openrouter_stream_chunk_parses_tool_calls_and_usage() -> None:
    payload = {
        "provider": "openrouter",
        "model": "openrouter/test",
        "choices": [
            {
                "index": 0,
                "delta": {
                    "content": "Hi",
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call-1",
                            "type": "function",
                            "function": {"name": "pinecone_query", "arguments": '{"query":"docs"}'},
                        }
                    ],
                },
            }
        ],
        "usage": {"total_tokens": 3},
    }

    parsed = OpenRouterStreamChunk.model_validate(payload)
    assert parsed.choices[0].delta
    assert parsed.choices[0].delta.tool_calls
    tool_call = parsed.choices[0].delta.tool_calls[0]
    assert tool_call.function
    assert tool_call.function.name == "pinecone_query"
    assert parsed.usage
    assert parsed.usage.total_tokens == 3


def test_openrouter_embeddings_response_allows_extra_fields() -> None:
    payload = {
        "id": "embed-1",
        "object": "list",
        "model": "test-embed",
        "data": [{"embedding": [0.1, 0.2], "index": 0, "extra": "keep"}],
        "usage": {"prompt_tokens": 3, "total_tokens": 3, "cost": 0.01},
        "new_field": {"nested": True},
    }

    parsed = OpenRouterEmbeddingsResponse.model_validate(payload)
    dumped = parsed.model_dump(exclude_none=True)

    assert dumped["new_field"]["nested"] is True
    assert dumped["data"][0]["extra"] == "keep"
    assert dumped["usage"]["cost"] == 0.01


def test_openrouter_rerank_response_parses_ranked_indexes() -> None:
    parsed = OpenRouterRerankResponse.model_validate(
        {
            "id": "rank-1",
            "model": "cohere/rerank-v3.5",
            "results": [
                {"index": 1, "relevance_score": 0.9},
                {"index": 0, "relevance_score": 0.2},
            ],
            "usage": {"total_tokens": 12},
        }
    )

    assert [result.index for result in parsed.results] == [1, 0]
    assert parsed.usage
    assert parsed.usage.total_tokens == 12
