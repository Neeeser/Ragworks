from __future__ import annotations

from argparse import Namespace
from pathlib import Path
from typing import Any

from scripts.backend_cli import cmd_models_list


class StubClient:
    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[tuple[str, bool]] = []

    def get(self, path: str, *, require_auth: bool = True) -> dict[str, Any]:
        self.calls.append((path, require_auth))
        return self.payload


def test_models_command_reads_unified_envelope_and_forces_chat_refresh(
    capsys,
) -> None:
    payload = {
        "models": [
            {
                "id": "chat/model",
                "provider_type": "openrouter",
                "context_length": 8192,
                "pricing": {"prompt": "0.1"},
            }
        ],
        "connection_errors": [],
        "meta": {"freshness": "fresh", "refreshing": False, "age_seconds": 0},
    }
    client = StubClient(payload)
    args = Namespace(refresh=True, limit=20, json=False)

    result = cmd_models_list(args, client, {}, Path("unused"))

    assert result == payload
    assert client.calls == [("/api/models?kind=chat&refresh=true", True)]
    assert "chat/model" in capsys.readouterr().out
