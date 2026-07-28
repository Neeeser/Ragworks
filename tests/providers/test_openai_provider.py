"""OpenAI provider behavior: bundle-backed catalog, resolver, and dialect fixes."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.db import models
from app.providers.chat.base import ChatRequest
from app.providers.chat.dialects import ResponsesProvider
from app.providers.openai import OpenAIAdapter
from app.providers.openai_bundle import (
    BundleEndpoints,
    BundleModel,
    OpenAIModelBundle,
    load_openai_bundle,
)
from app.providers.openai_catalog import CatalogConnection, classify_openai_models
from app.schemas.enums import ProviderKind, ProviderType
from app.services.errors import ExternalServiceError

FLOOR = ["temperature", "top_p", "max_tokens", "reasoning", "tools"]


def _bundle_entry(*, deprecated: bool) -> BundleModel:
    return BundleModel(
        display_name=None,
        context_window=8192,
        max_output_tokens=1024,
        input_modalities=["text"],
        output_modalities=["text"],
        knowledge_cutoff=None,
        reasoning=False,
        reasoning_efforts=None,
        endpoints=BundleEndpoints(chat_completions=True, responses=True, embeddings=False),
        function_calling=True,
        structured_outputs=True,
        streaming=True,
        deprecated=deprecated,
        snapshots=[],
    )


def _connection() -> CatalogConnection:
    return CatalogConnection(id=uuid4(), label="OpenAI", provider_type=ProviderType.OPENAI)


def _chat_catalog(ids: list[str]) -> dict[str, Any]:
    models_list = classify_openai_models(
        ids,
        kind=ProviderKind.CHAT,
        connection=_connection(),
        chat_parameters=FLOOR,
        bundle=load_openai_bundle(),
    )
    return {model.id: model for model in models_list}


class TestBundleRefinedCatalog:
    def test_non_reasoning_model_loses_only_the_reasoning_knob(self) -> None:
        model = _chat_catalog(["gpt-4.1"])["gpt-4.1"]
        assert "reasoning" not in model.supported_parameters
        assert set(model.supported_parameters) == set(FLOOR) - {"reasoning"}

    def test_reasoning_model_keeps_the_knob_and_reports_effort_levels(self) -> None:
        model = _chat_catalog(["gpt-5.4-nano"])["gpt-5.4-nano"]
        assert "reasoning" in model.supported_parameters
        assert model.reasoning_efforts == ["none", "low", "medium", "high", "xhigh"]

    def test_context_window_comes_from_the_bundle(self) -> None:
        model = _chat_catalog(["gpt-4.1"])["gpt-4.1"]
        assert model.context_length == 1_047_576

    def test_unknown_model_keeps_the_full_floor(self) -> None:
        """A model OpenAI ships tomorrow appears with working parameters."""
        model = _chat_catalog(["some-future-model-9"])["some-future-model-9"]
        assert model.supported_parameters == FLOOR
        assert model.context_length is None

    def test_deprecated_models_sink_to_the_end_but_stay_listed(self) -> None:
        # Synthetic bundle: the live listing currently has no deprecated-marked
        # model, but the ordering contract must hold when one appears.
        bundle = OpenAIModelBundle(
            source="test",
            generated_at="2026-07-28",
            models={
                "a-old-model": _bundle_entry(deprecated=True),
                "z-new-model": _bundle_entry(deprecated=False),
            },
            unresolved=[],
        )
        listing = classify_openai_models(
            ["a-old-model", "z-new-model"],
            kind=ProviderKind.CHAT,
            connection=_connection(),
            chat_parameters=FLOOR,
            bundle=bundle,
        )
        assert [m.id for m in listing] == ["z-new-model", "a-old-model"]
        assert listing[-1].deprecated is True


class TestAdapterModelResolver:
    def _adapter(self) -> OpenAIAdapter:
        row = models.ProviderConnection(
            user_id=uuid4(),
            provider_type=ProviderType.OPENAI.value,
            label="OpenAI",
            config={"api_key": "sk-test"},
        )
        return OpenAIAdapter(row)

    def test_known_model_resolves_real_context_window(self) -> None:
        info = self._adapter()._resolve_model("gpt-4.1")
        assert info.context_length == 1_047_576
        assert "reasoning" not in info.supported_parameters

    def test_snapshot_id_resolves_through_its_base_model(self) -> None:
        info = self._adapter()._resolve_model("gpt-4.1-2025-04-14")
        assert info.context_length == 1_047_576

    def test_unknown_model_still_resolves_to_the_floor(self) -> None:
        """The bundle is not the account catalog: unknown ids must keep working."""
        info = self._adapter()._resolve_model("some-future-model-9")
        assert info.context_length is None
        assert "temperature" in info.supported_parameters


def _request(
    parameters: dict[str, Any] | None, extra_body: dict[str, Any] | None = None
) -> ChatRequest:
    return ChatRequest(
        messages=[{"role": "user", "content": "hi"}],
        tools=None,
        model="gpt-4.1",
        parameters=parameters,
        extra_body=extra_body,
    )


class TestResponsesParameterMapping:
    def test_canonical_max_tokens_renames_to_max_output_tokens(self) -> None:
        mapped = ResponsesProvider._parameters(_request({"max_tokens": 512}))
        assert mapped == {"max_output_tokens": 512}

    def test_response_format_moves_under_text_format(self) -> None:
        mapped = ResponsesProvider._parameters(
            _request({"response_format": {"type": "json_object"}})
        )
        assert mapped == {"text": {"format": {"type": "json_object"}}}

    def test_json_schema_envelope_is_flattened(self) -> None:
        mapped = ResponsesProvider._parameters(
            _request(
                {
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {"name": "answer", "schema": {"type": "object"}},
                    }
                }
            )
        )
        assert mapped == {
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "answer",
                    "schema": {"type": "object"},
                }
            }
        }


def test_responses_call_carries_the_user_extra_body() -> None:
    provider = ResponsesProvider(object(), name="openai")  # type: ignore[arg-type]
    call = provider._call(_request({"max_tokens": 64}, extra_body={"service_tier": "flex"}))
    assert call.extra_body == {"service_tier": "flex"}
    assert call.parameters == {"max_output_tokens": 64}


class TestChatCompletionsStreamUsage:
    def test_streaming_requests_a_usage_chunk(self) -> None:
        """Without stream_options, OpenAI-compatible servers emit no usage at all."""
        from app.clients.openai_compat.chat import ChatCall, _build_kwargs
        from app.clients.openai_compat.transport import (
            OpenAICompatTransport,
            TransportConfig,
        )

        transport = OpenAICompatTransport(
            TransportConfig(base_url="http://localhost:9", api_key="k")
        )
        call = ChatCall(messages=[{"role": "user", "content": "hi"}], model="m")
        streamed = _build_kwargs(transport, call, stream=True)
        assert streamed["stream_options"] == {"include_usage": True}
        buffered = _build_kwargs(transport, call, stream=False)
        assert "stream_options" not in buffered


class TestResponsesFailureSurfaces:
    def _provider(self) -> ResponsesProvider:
        return ResponsesProvider(object(), name="openai")  # type: ignore[arg-type]

    def test_failed_buffered_response_raises_with_the_provider_message(self) -> None:
        payload = {
            "id": "resp_1",
            "status": "failed",
            "error": {"code": "server_error", "message": "The model crashed."},
            "output": [],
        }
        with pytest.raises(ExternalServiceError, match="The model crashed"):
            self._provider().parse_chat_response(payload)

    def test_failed_stream_event_raises_instead_of_ending_quietly(self) -> None:
        event = {
            "type": "response.failed",
            "response": {
                "id": "resp_1",
                "status": "failed",
                "error": {"code": "server_error", "message": "Upstream fell over."},
                "output": [],
            },
        }
        with pytest.raises(ExternalServiceError, match="Upstream fell over"):
            self._provider().parse_stream_chunk(event)
