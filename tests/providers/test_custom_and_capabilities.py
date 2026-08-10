"""Behavior specific to the custom provider and to live capability derivation."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, ClassVar
from uuid import uuid4

import httpx
import pytest

from app.clients.anthropic import DEFAULT_MAX_TOKENS
from app.clients.anthropic.client import AnthropicClient
from app.clients.openai_compat import normalize_openai_base_url
from app.clients.openai_compat.probe import (
    EndpointProbe,
    ProbeOutcome,
    ServerProbe,
    probe_endpoint,
)
from app.db import models
from app.providers.chat.base import ChatRequest
from app.providers.chat.dialects import MessagesProvider
from app.providers.chat.dialects.messages import model_info_from_catalog
from app.providers.custom import CustomAdapter
from app.providers.openai_catalog import CatalogConnection, classify_openai_models
from app.schemas.anthropic import AnthropicModel
from app.schemas.enums import ProviderKind, ProviderType
from app.schemas.models import ReasoningStyle
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
        assert (
            normalize_openai_base_url("https://gw.example.com/llm/") == "https://gw.example.com/llm"
        )


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
                return httpx.Response(status_code=status, request=httpx.Request("POST", SERVER_URL))

        transport = SimpleNamespace(http=_Http())
        probe = probe_endpoint(transport, "/chat/completions")  # type: ignore[arg-type]

        assert probe.outcome is expected

    def test_a_transport_failure_reports_unreachable_not_absent(self) -> None:
        """ "No chat endpoint" would send the user to fix the wrong field."""

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
            _custom_connection(serves_chat=True, serves_embeddings=False, serves_reranking=True)
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
        monkeypatch.setattr(CustomAdapter, "_client", lambda self: _StubClient(probe))

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

    def test_an_adaptive_only_model_is_offered_no_sampling_parameters(self) -> None:
        """A model publishing no `enabled` mode reasons on every turn, and
        rejects temperature/top_p/top_k outright while it does."""
        model = AnthropicModel.model_validate(
            {
                "id": "claude-opus-5",
                "display_name": "Claude Opus 5",
                "max_input_tokens": 1_000_000,
                "capabilities": {
                    "thinking": {
                        "supported": True,
                        "types": {
                            "adaptive": {"supported": True},
                            "enabled": {"supported": False},
                        },
                    },
                    "effort": {
                        "supported": True,
                        "low": {"supported": True},
                        "medium": {"supported": True},
                        "high": {"supported": True},
                        "xhigh": {"supported": True},
                        "max": {"supported": True},
                    },
                },
            }
        )

        info = model_info_from_catalog(model)

        assert "temperature" not in info.supported_parameters
        assert "top_p" not in info.supported_parameters
        assert info.capabilities.reasoning is ReasoningStyle.BLOCK
        # Effort levels come from the model's own tree — `xhigh`/`max` exist
        # only on the newer generations, so a shipped list would be wrong.
        assert info.capabilities.reasoning_efforts == [
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
        ]
        assert info.context_length == 1_000_000

    def test_a_model_publishing_both_modes_keeps_its_sampling_parameters(self) -> None:
        """`adaptive` alone mislabels these: 4.6 publishes both modes and
        still takes samplers when it is not asked to think."""
        model = AnthropicModel.model_validate(
            {
                "id": "claude-sonnet-4-6",
                "display_name": "Claude Sonnet 4.6",
                "max_input_tokens": 200_000,
                "capabilities": {
                    "thinking": {
                        "supported": True,
                        "types": {
                            "adaptive": {"supported": True},
                            "enabled": {"supported": True},
                        },
                    },
                    "effort": {
                        "supported": True,
                        "low": {"supported": True},
                        "medium": {"supported": True},
                        "high": {"supported": True},
                        "max": {"supported": True},
                    },
                },
            }
        )

        info = model_info_from_catalog(model)

        assert "temperature" in info.supported_parameters
        assert info.capabilities.reasoning_efforts == ["low", "medium", "high", "max"]

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
        # Thinking without effort: the model takes a budget, not a level.
        assert info.capabilities.reasoning is ReasoningStyle.BLOCK
        assert info.capabilities.reasoning_efforts == []
        assert info.name == "Claude Haiku 4.5"


class TestOpenAIModelClassification:
    """Unknown ids fall through to chat rather than disappearing."""

    def _classify(self, ids: list[str], kind: ProviderKind) -> list[str]:
        return [
            model.id
            for model in classify_openai_models(
                ids,
                kind=kind,
                connection=CatalogConnection(
                    id=uuid4(), label="OpenAI", provider_type=ProviderType.OPENAI
                ),
                chat_parameters=["temperature"],
            )
        ]

    def test_a_model_released_after_this_code_still_appears_in_chat(self) -> None:
        """A marker allowlist would hide every future model until someone edits it."""
        assert "some-future-model-9" in self._classify(["some-future-model-9"], ProviderKind.CHAT)

    def test_embedding_models_are_kept_out_of_the_chat_list(self) -> None:
        listed = self._classify(["text-embedding-3-small", "gpt-5.6-luna"], ProviderKind.CHAT)

        assert listed == ["gpt-5.6-luna"]

    def test_only_embedding_models_reach_the_embedding_list(self) -> None:
        listed = self._classify(
            ["text-embedding-3-small", "gpt-5.6-luna", "whisper-1"], ProviderKind.EMBEDDING
        )

        assert listed == ["text-embedding-3-small"]


class TestAnthropicAliasResolution:
    """A documented alias must resolve even though `/v1/models` omits it."""

    class _StubCatalog:
        """An Anthropic client stub holding a fixed published listing."""

        def __init__(self, ids: list[str]) -> None:
            self._models = [AnthropicModel(id=model_id) for model_id in ids]

        def list_models(self, force_refresh: bool = False) -> Any:
            del force_refresh
            return SimpleNamespace(value=self._models)

        get_model = AnthropicClient.get_model

    def test_an_undated_alias_resolves_to_its_only_dated_snapshot(self) -> None:
        """Anthropic serves `claude-haiku-4-5`; the listing names the snapshot."""
        catalog = self._StubCatalog(["claude-haiku-4-5-20251001", "claude-opus-5"])

        resolved = catalog.get_model("claude-haiku-4-5")

        assert resolved is not None
        assert resolved.id == "claude-haiku-4-5-20251001"

    def test_an_exact_id_still_wins_over_prefix_matching(self) -> None:
        catalog = self._StubCatalog(["claude-opus-5", "claude-opus-5-20260101"])

        resolved = catalog.get_model("claude-opus-5")

        assert resolved is not None
        assert resolved.id == "claude-opus-5"

    def test_an_ambiguous_alias_reports_unknown_rather_than_guessing(self) -> None:
        """Two snapshots means the user's intent is genuinely undetermined."""
        catalog = self._StubCatalog(["claude-haiku-4-5-20251001", "claude-haiku-4-5-20260101"])

        assert catalog.get_model("claude-haiku-4-5") is None


class TestAnthropicMaxTokens:
    """Anthropic requires `max_tokens`; the default must be a request size."""

    @staticmethod
    def _model(max_tokens: int) -> AnthropicModel:
        return AnthropicModel(id="claude-test", max_tokens=max_tokens)

    @staticmethod
    def _request(**parameters: Any) -> ChatRequest:
        return ChatRequest(
            messages=[], tools=None, model="claude-test", parameters=parameters or None
        )

    def test_the_default_is_an_answer_size_not_the_model_ceiling(self) -> None:
        """The SDK refuses a buffered call whose ceiling implies a long run."""
        resolved = MessagesProvider._max_tokens(self._request(), self._model(128_000))

        assert resolved == DEFAULT_MAX_TOKENS

    def test_an_explicit_value_is_honoured(self) -> None:
        resolved = MessagesProvider._max_tokens(
            self._request(max_tokens=2048), self._model(128_000)
        )

        assert resolved == 2048

    def test_an_explicit_value_is_clamped_to_the_model_ceiling(self) -> None:
        """Over-large is trimmed rather than 400-ing at the provider."""
        resolved = MessagesProvider._max_tokens(
            self._request(max_tokens=200_000), self._model(64_000)
        )

        assert resolved == 64_000

    def test_a_low_ceiling_caps_the_default(self) -> None:
        resolved = MessagesProvider._max_tokens(self._request(), self._model(4096))

        assert resolved == 4096


class TestCustomModelOrdering:
    """A guess may reorder a custom server's listing; it may never shorten it."""

    LISTING: ClassVar[list[str]] = [
        "gpt-4o-mini",
        "text-embedding-3-small",
        "whisper-1",
        "my-local-model",
    ]

    def test_embedding_models_lead_the_embedding_listing(self) -> None:
        ordered = CustomAdapter._ordered_for_kind(self.LISTING, ProviderKind.EMBEDDING)

        assert ordered[0] == "text-embedding-3-small"

    def test_every_model_is_still_selectable_for_every_kind(self) -> None:
        """Filtering would hide a model whose name does not match a convention."""
        for kind in (ProviderKind.EMBEDDING, ProviderKind.CHAT, ProviderKind.RERANKING):
            ordered = CustomAdapter._ordered_for_kind(self.LISTING, kind)

            assert sorted(ordered) == sorted(self.LISTING)

    def test_an_unrecognized_model_still_leads_the_chat_listing(self) -> None:
        """A locally-served model has no naming convention to match."""
        ordered = CustomAdapter._ordered_for_kind(self.LISTING, ProviderKind.CHAT)

        assert ordered[0] == "gpt-4o-mini"
        assert ordered.index("my-local-model") < ordered.index("whisper-1")
