"""Shared HTTP + SDK transport for any OpenAI-compatible server.

One transport binds a base URL, an optional API key, and any static headers to
a single `httpx.Client` that the OpenAI SDK shares. Sharing matters: without
`http_client=`, the SDK builds its own pool that `close()` never reaches, so
every rotated credential leaks the connections carrying chat traffic.

The two timeouts are deliberately different. REST calls (`/models`, `/rerank`)
get a flat 60s; the SDK keeps its own 600s ceiling because a reasoning model's
first token can arrive minutes in, and inheriting the REST timeout would abort
a chat turn that was working.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

import httpx
from openai import OpenAI

#: Sent as the API key when a server needs none. The OpenAI SDK refuses to
#: construct without a key, and a local llama.cpp or LM Studio server ignores
#: whatever it is given — so a placeholder is what keeps keyless servers usable.
KEYLESS_PLACEHOLDER = "not-required"

REST_TIMEOUT_SECONDS = 60.0
INFERENCE_TIMEOUT_SECONDS = 600.0
CONNECT_TIMEOUT_SECONDS = 5.0


def normalize_openai_base_url(base_url: str) -> str:
    """Return the base URL the OpenAI SDK should be pointed at.

    A server URL a user copies off their own machine (`http://localhost:8000`)
    names no path, and every OpenAI-compatible server mounts its surface under
    `/v1` — so a bare origin is completed rather than left to 404 on every
    call. A URL that already carries a path is left exactly as typed: a server
    behind a reverse-proxy prefix (`https://gw.example.com/llm/v1`) is only
    reachable at the path its operator chose, and "helpfully" appending to it
    breaks the one case the field exists for.
    """
    parts = urlsplit(base_url.strip())
    path = parts.path.rstrip("/")
    if not path:
        path = "/v1"
    return urlunsplit(parts._replace(path=path, query="", fragment=""))


@dataclass(frozen=True)
class TransportConfig:
    """Identity of one OpenAI-compatible endpoint."""

    base_url: str
    api_key: str | None = None
    #: Static headers every request carries (OpenRouter's attribution pair,
    #: a gateway's tenant header). Kept as a tuple so the config stays hashable
    #: and can key a client cache.
    headers: tuple[tuple[str, str], ...] = ()
    #: Header the key is sent in. Anthropic-compatible gateways want
    #: `x-api-key`; everything OpenAI-shaped wants `Authorization: Bearer`.
    auth_scheme: str = "bearer"

    def auth_headers(self) -> dict[str, str]:
        """Return the authorization headers for this endpoint, if it has a key."""
        if not self.api_key:
            return {}
        if self.auth_scheme == "x-api-key":
            return {"x-api-key": self.api_key}
        return {"Authorization": f"Bearer {self.api_key}"}


class OpenAICompatTransport:
    """An `httpx.Client` and an OpenAI SDK client over one endpoint."""

    def __init__(self, config: TransportConfig) -> None:
        """Build the shared HTTP client and the SDK client that rides on it."""
        self.config = config
        self.base_url = normalize_openai_base_url(config.base_url)
        self.static_headers = dict(config.headers)
        headers = {**self.static_headers, **config.auth_headers()}
        self.http = httpx.Client(
            base_url=self.base_url,
            headers=headers,
            timeout=REST_TIMEOUT_SECONDS,
            follow_redirects=True,
        )
        self.sdk = OpenAI(
            base_url=self.base_url,
            api_key=config.api_key or KEYLESS_PLACEHOLDER,
            http_client=self.http,
            timeout=httpx.Timeout(
                INFERENCE_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS
            ),
            max_retries=1,
        )

    def merge_headers(self, extra: dict[str, str] | None) -> dict[str, str]:
        """Merge per-call headers over this endpoint's static ones."""
        if not extra:
            return dict(self.static_headers)
        return {**self.static_headers, **extra}

    def close(self) -> None:
        """Close the SDK and the HTTP pool it shares."""
        self.sdk.close()
        self.http.close()
