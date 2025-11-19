from __future__ import annotations

import time
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote

import httpx
from openai import OpenAI

from app.api.config import get_settings
from app.schemas.models import EndpointsListResponse, ModelInfo


class OpenRouterClient:
    """Wrapper around the OpenRouter HTTP + OpenAI-compatible SDK."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self._app_headers = self._build_app_headers()
        default_headers = {"Authorization": f"Bearer {self.settings.openrouter_api_key}"}
        default_headers.update(self._app_headers)

        self._http = httpx.Client(
            base_url=self.settings.openrouter_base_url,
            headers=default_headers,
            timeout=60.0,
        )
        self._client = OpenAI(
            base_url=self.settings.openrouter_base_url,
            api_key=self.settings.openrouter_api_key,
        )
        self._model_cache: dict[str, Any] = {"ts": 0.0, "data": []}

    def _build_app_headers(self) -> Dict[str, str]:
        headers = {"X-Title": self.settings.openrouter_site_name or "TransparentRag"}
        if self.settings.openrouter_site_url:
            headers["HTTP-Referer"] = self.settings.openrouter_site_url
        return headers

    def _merge_extra_headers(self, extra_headers: Optional[Dict[str, str]]) -> Dict[str, str]:
        if extra_headers:
            merged = dict(self._app_headers)
            merged.update(extra_headers)
            return merged
        return dict(self._app_headers)

    def list_models(self, force_refresh: bool = False) -> List[ModelInfo]:
        now = time.time()
        if not force_refresh and now - self._model_cache["ts"] < 300 and self._model_cache["data"]:
            return self._model_cache["data"]
        response = self._http.get("/models")
        response.raise_for_status()
        payload = response.json()
        models = [ModelInfo(**item) for item in payload.get("data", [])]
        self._model_cache = {"ts": now, "data": models}
        return models

    def get_model(self, model_id: str) -> Optional[ModelInfo]:
        if not model_id:
            return None

        def _match(models: List[ModelInfo]) -> Optional[ModelInfo]:
            for model in models:
                if model.id == model_id or model.canonical_slug == model_id:
                    return model
            normalized = model_id.lower()
            for model in models:
                if model.id.lower() == normalized or (model.canonical_slug and model.canonical_slug.lower() == normalized):
                    return model
            return None

        cached = self.list_models()
        match = _match(cached)
        if match:
            return match
        refreshed = self.list_models(force_refresh=True)
        return _match(refreshed)

    def list_model_endpoints(self, author: str, slug: str) -> EndpointsListResponse:
        author_segment = quote(author, safe="")
        slug_segment = quote(slug, safe="")
        response = self._http.get(f"/models/{author_segment}/{slug_segment}/endpoints")
        response.raise_for_status()
        payload = response.json()
        return EndpointsListResponse(**payload)

    def embed(
        self,
        texts: Iterable[str],
        model: Optional[str] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> dict[str, Any]:
        headers = self._merge_extra_headers(extra_headers)
        embeddings = self._client.embeddings.create(
            model=model or self.settings.default_embedding_model,
            input=list(texts),
            encoding_format="float",
            extra_headers=headers,
        )
        return embeddings.model_dump()

    def chat(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Dict[str, Any]] = None,
        parallel_tool_calls: Optional[bool] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        extra_body: Optional[Dict[str, Any]] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ) -> dict[str, Any]:
        kwargs: Dict[str, Any] = {"messages": messages, "model": model or self.settings.default_chat_model}
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
        if parallel_tool_calls is not None:
            kwargs["parallel_tool_calls"] = parallel_tool_calls
        kwargs["extra_headers"] = self._merge_extra_headers(extra_headers)
        if extra_body:
            kwargs["extra_body"] = extra_body
        if parameters:
            for key, value in parameters.items():
                if value is not None:
                    kwargs[key] = value
        response = self._client.chat.completions.create(**kwargs)
        return response.model_dump()

    def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Dict[str, Any]] = None,
        parallel_tool_calls: Optional[bool] = None,
        extra_headers: Optional[Dict[str, str]] = None,
        extra_body: Optional[Dict[str, Any]] = None,
        parameters: Optional[Dict[str, Any]] = None,
    ):
        kwargs: Dict[str, Any] = {"messages": messages, "model": model or self.settings.default_chat_model}
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
        if parallel_tool_calls is not None:
            kwargs["parallel_tool_calls"] = parallel_tool_calls
        kwargs["extra_headers"] = self._merge_extra_headers(extra_headers)
        if extra_body:
            kwargs["extra_body"] = extra_body
        if parameters:
            for key, value in parameters.items():
                if value is not None:
                    kwargs[key] = value
        kwargs["stream"] = True
        stream = self._client.chat.completions.create(**kwargs)
        for chunk in stream:
            yield chunk.model_dump()


@lru_cache(maxsize=1)
def get_openrouter_client() -> OpenRouterClient:
    return OpenRouterClient()
