"""Behavior specific to the custom provider and to live capability derivation."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import httpx
import pytest

from app.clients.openai_compat import normalize_openai_base_url
from app.clients.openai_compat.probe import (
    EndpointProbe,
    ProbeOutcome,
    ServerProbe,
    probe_endpoint,
)
from app.db import models
from app.providers.chat.dialects.messages import model_info_from_catalog
from app.providers.custom import CustomAdapter
from app.providers.openai_catalog import classify_openai_models
from app.schemas.anthropic import AnthropicModel
from app.schemas.enums import ProviderKind, ProviderType
from app.services.errors import InvalidInputError

SERVER_URL = "http://localhost:8000"


def _custom_connection(**config: Any) -> models.ProviderConnection:
    """A custom connection row with the given capability configuration."""
    return models.ProviderConnection(
        user_id=uuid4(),
        provider_type=ProviderType.CUSTOM.value,
        label="vLLM",
        config={"base_url": SERVER_URL, **config},
    )


class TestBaseUrlNormalization:
    """A URL a user reads off their own machine has to reach the API."""

    def test_a_bare_origin_gains_the_v1_prefix(self) -> None:
        """Every OpenAI-compatible server mounts its surface under /v1."""
        assert normalize_openai_base_url(SERVER_URL) == f"{SERVER_URL}/v1"

    def test_an_explicit_path_is_left_exactly_as_typed(self) -> None:
        """A proxy prefix is only reachable at the path its operator chose."""
        assert (
            normalize_openai_base_url("https://gw.example.com/llm/v1")
            == "https://gw.example.com/llm/v1"
        )

    def test_a_trailing_slash_does_not_become_a_second_segment(self) -> None:
        assert normalize_openai_base_url("https://gw.example.com/llm/") == "https://gw.example.com/llm"


class TestEndpointProbe:
    """Discovery reads the status, never the payload."""

    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (400, ProbeOutcome.AVAILABLE),
            (422, ProbeOutcome.AVAILABLE),
            (200, ProbeOutcome.AVAILABLE),
            (404, ProbeOutcome.ABSENT),
            (501, ProbeOutcome.ABSENT),
            (401, ProbeOutcome.UNAUTHORIZED),
            (403, ProbeOutcome.UNAUTHORIZED),
        ],
    )
    def test_status_decides_the_outcome(self, status: int, expected: ProbeOutcome) -> None:
        """400 means the path exists and rejected our deliberately-invalid body."""

        class _Http:
            def post(self, _path: str, json: Any) -> httpx.Response:
                del json
                return httpx.Response(
                    status_code=status, request=httpx.Request("POST", SERVER_URL)
                )

        transport = SimpleNamespace(http=_Http())
        probe = probe_endpoint(transport, "/chat/completions")  # type: ignore[arg-type]

        assert probe.outcome is expected

    def test_a_transport_failure_reports_unreachable_not_absent(self) -> None:
        """"No chat endpoint" would send the user to fix the wrong field."""

        class _Http:
            def post(self, _path: str, json: Any) -> httpx.Response:
                del json
                raise httpx.ConnectError("refused")

        transport = SimpleNamespace(http=_Http())
        probe = probe_endpoint(transport, "/chat/completions")  # type: ignore[arg-type]

        assert probe.outcome is ProbeOutcome.UNREACHABLE


class TestCustomAdapterCapabilities:
    """The stored flags, not the live probe, decide what a connection serves."""

    def test_kinds_reflect_only_the_confirmed_capabilities(self) -> None:
        adapter = CustomAdapter(
            _custom_connection(
                serves_chat=True, serves_embeddings=False, serves_reranking=True
            )
        )

        assert adapter.kinds == (ProviderKind.CHAT, ProviderKind.RERANKING)

    def test_an_unserved_kind_is_refused_with_a_clear_error(self) -> None:
        """A kind gate must be a 400, not an AttributeError deeper in a run."""
        adapter = CustomAdapter(_custom_connection(serves_embeddings=False))

        with pytest.raises(InvalidInputError, match="do not provide embedding models"):
            adapter.embedder("some-model")

    def test_validation_names_the_surfaces_that_did_not_answer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The user has to know which checkbox to clear, not just that it failed."""
        absent = EndpointProbe("/embeddings", ProbeOutcome.ABSENT, 404)
        available = EndpointProbe("/chat/completions", ProbeOutcome.AVAILABLE, 400)
        probe = ServerProbe(
            reachable=True,
            chat=available,
            embeddings=absent,
            rerank=absent,
            responses=absent,
            model_ids=("m",),
        )
        adapter = CustomAdapter(_custom_connection(serves_chat=True, serves_embeddings=True))
        monkeypatch.setattr(
            CustomAdapter, "_client", lambda self: _StubClient(probe)
        )

        result = adapter.validate_connection()

        assert result.valid is False
        assert result.message is not None
        assert "embedding" in result.message

    def test_validation_passes_when_every_declared_surface_answers(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        available = EndpointProbe("/chat/completions", ProbeOutcome.AVAILABLE, 400)
        probe = ServerProbe(
            reachable=True,
            chat=available,
            embeddings=available,
            rerank=available,
            responses=available,
            model_ids=("m",),
        )
        adapter = CustomAdapter(
            _custom_connection(serves_chat=True, serves_embeddings=True, serves_reranking=False)
        )
        monkeypatch.setattr(CustomAdapter, "_client", lambda self: _StubClient(probe))

        result = adapter.validate_connection()

        assert result.valid is True
        assert result.message is not None
        assert "1 models" in result.message


class _StubClient:
    """An OpenAI-compatible client stub that returns a fixed probe."""

    def __init__(self, probe: ServerProbe) -> None:
        self._probe = probe

    def probe(self) -> ServerProbe:
        return self._probe


class TestAnthropicCapabilityDerivation:
    """Which parameters a Claude model accepts is read live, never shipped."""

    def test_an_adaptive_thinking_model_is_offered_no_sampling_parameters(self) -> None:
        """The generation that gained adaptive thinking rejects them with a 400."""
        model = AnthropicModel.model_validate(
            {
                "id": "claude-opus-5",
                "display_name": "Claude Opus 5",
                "max_input_tokens": 1_000_000,
                "capabilities": {
                    "thinking": {"supported": True, "types": {"adaptive": {"supported": True}}},
                    "effort": {"supported": True},
                },
            }
        )

        info = model_info_from_catalog(model)

        assert "temperature" not in info.supported_parameters
        assert "top_p" not in info.supported_parameters
        assert "reasoning" in info.supported_parameters
        assert info.context_length == 1_000_000

    def test_a_budgeted_thinking_model_keeps_its_sampling_parameters(self) -> None:
        """Haiku 4.5 still accepts them, so hiding them would remove real control."""
        model = AnthropicModel.model_validate(
            {
                "id": "claude-haiku-4-5",
                "display_name": "Claude Haiku 4.5",
                "max_input_tokens": 200_000,
                "capabilities": {
                    "thinking": {"supported": True, "types": {"enabled": {"supported": True}}},
                    "effort": {"supported": False},
                },
            }
        )

        info = model_info_from_catalog(model)

        assert "temperature" in info.supported_parameters
        assert "top_k" in info.supported_parameters
        assert info.name == "Claude Haiku 4.5"


class TestOpenAIModelClassification:
    """Unknown ids fall through to chat rather than disappearing."""

    def _classify(self, ids: list[str], kind: ProviderKind) -> list[str]:
        return [
            model.id
            for model in classify_openai_models(
                ids,
                kind=kind,
                connection_id=uuid4(),
                connection_label="OpenAI",
                provider_type=ProviderType.OPENAI,
                chat_parameters=["temperature"],
            )
        ]

    def test_a_model_released_after_this_code_still_appears_in_chat(self) -> None:
        """A marker allowlist would hide every future model until someone edits it."""
        assert "some-future-model-9" in self._classify(
            ["some-future-model-9"], ProviderKind.CHAT
        )

    def test_embedding_models_are_kept_out_of_the_chat_list(self) -> None:
        listed = self._classify(
            ["text-embedding-3-small", "gpt-5.6-luna"], ProviderKind.CHAT
        )

        assert listed == ["gpt-5.6-luna"]

    def test_only_embedding_models_reach_the_embedding_list(self) -> None:
        listed = self._classify(
            ["text-embedding-3-small", "gpt-5.6-luna", "whisper-1"], ProviderKind.EMBEDDING
        )

        assert listed == ["text-embedding-3-small"]
