from __future__ import annotations

import time
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Optional

import httpx
from openai import OpenAI

from app.api.config import get_settings
from app.schemas.models import ModelInfo


class OpenRouterClient:
    """Wrapper around the OpenRouter HTTP + OpenAI-compatible SDK."""

    def __init__(self) -> None:
        self.settings = get_settings()
        default_headers = {"Authorization": f"Bearer {self.settings.openrouter_api_key}"}
        if self.settings.openrouter_site_url:
            default_headers["HTTP-Referer"] = self.settings.openrouter_site_url
        if self.settings.openrouter_site_name:
            default_headers["X-Title"] = self.settings.openrouter_site_name

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
        for model in self.list_models():
            if model.id == model_id:
                return model
        return None

    def embed(
        self,
        texts: Iterable[str],
        model: Optional[str] = None,
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> dict[str, Any]:
        headers = extra_headers or {}
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
    ) -> dict[str, Any]:
        kwargs: Dict[str, Any] = {"messages": messages, "model": model or self.settings.default_chat_model}
        if tools:
            kwargs["tools"] = tools
        if tool_choice:
            kwargs["tool_choice"] = tool_choice
        if parallel_tool_calls is not None:
            kwargs["parallel_tool_calls"] = parallel_tool_calls
        if extra_headers:
            kwargs["extra_headers"] = extra_headers
        if extra_body:
            kwargs["extra_body"] = extra_body
        response = self._client.chat.completions.create(**kwargs)
        return response.model_dump()


@lru_cache(maxsize=1)
def get_openrouter_client() -> OpenRouterClient:
    return OpenRouterClient()
