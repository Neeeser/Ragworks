#!/usr/bin/env python
"""Opt-in smoke harness for provider-backed pipeline reranking.

Run only with deliberately exported provider credentials, for example:

```
RAGWORKS_LIVE_PROVIDER_RERANKING=1 OPENROUTER_API_KEY=... \\
OPENROUTER_RERANK_MODEL=... uv run python scripts/smoke_provider_reranking.py \\
  --live --provider openrouter
```

Secrets are read only from environment variables. This module never writes,
logs, or includes them in command output.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import uuid4

from sqlmodel import Session, create_engine

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.limiting import ResultLimitConfig, ResultLimitNode
from app.pipelines.nodes.reranking import RerankerConfig, RerankerNode
from app.pipelines.payloads import RetrievalPayload
from app.providers.registry import ProviderResolver, build_adapter, close_provider_clients
from app.retrieval.models import DocumentChunk, DocumentMetadata, RetrievalResponse, ScoredChunk
from app.schemas.enums import ProviderType
from app.utils.file_storage import FileStorage
from app.vectorstores.registry import VectorStoreProvider

ProviderName = Literal["openrouter", "cohere"]
_ENV_ENABLED = "RAGWORKS_LIVE_PROVIDER_RERANKING"
_ENVIRONMENT: dict[ProviderName, tuple[str, str]] = {
    "openrouter": ("OPENROUTER_API_KEY", "OPENROUTER_RERANK_MODEL"),
    "cohere": ("COHERE_API_KEY", "COHERE_RERANK_MODEL"),
}
_RESULT_LIMIT = 2


@dataclass(frozen=True)
class LiveRerankingTarget:
    """A provider/model pair whose secret stays in the environment only."""

    provider: ProviderName
    model: str


@dataclass(frozen=True)
class LiveSmokeResult:
    """Non-sensitive counts emitted by a completed smoke run."""

    reranked_count: int
    result_limit: int
    limited_count: int


def live_target_from_environment(provider: ProviderName) -> LiveRerankingTarget | None:
    """Return an enabled target only when all required non-empty values exist."""
    if os.environ.get(_ENV_ENABLED) != "1":
        return None
    api_key_name, model_name = _ENVIRONMENT[provider]
    if not os.environ.get(api_key_name, "").strip() or not os.environ.get(model_name, "").strip():
        return None
    return LiveRerankingTarget(provider=provider, model=os.environ[model_name].strip())


def _candidates() -> list[ScoredChunk]:
    """Return deliberately non-ranked candidates for the live provider request."""
    texts = [
        "Mercury is the closest planet to the Sun.",
        "Paris is the capital city of France.",
        "A capital letter begins a sentence.",
        "France uses the euro as its currency.",
    ]
    return [
        ScoredChunk(
            chunk=DocumentChunk(
                document_id="live-smoke",
                chunk_id=f"live-smoke:{index}",
                text=text,
                order=index,
                metadata=DocumentMetadata(),
            ),
            score=float(len(texts) - index),
        )
        for index, text in enumerate(texts)
    ]


def _create_context(
    session: Session,
    user: models.User,
    storage_path: Path,
) -> PipelineRunContext:
    """Build the ordinary run context used by the reranker pipeline node."""
    collection = models.Collection(
        user_id=user.id,
        name="Provider reranking smoke",
        extra_metadata={},
    )
    return PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=None,
        query="What is the capital of France?",
        top_k=_RESULT_LIMIT,
        providers=ProviderResolver(user, session),
        vector_stores=VectorStoreProvider(user, session),
        storage=FileStorage(base_path=storage_path),
        settings=get_settings(),
    )


def _ordered_chunk_ids(matches: Sequence[ScoredChunk]) -> list[str]:
    """Extract identity without emitting request text or provider configuration."""
    return [match.chunk.chunk_id for match in matches]


def run_live_smoke(target: LiveRerankingTarget) -> LiveSmokeResult:
    """Exercise a real adapter and node path, then verify the later final cut."""
    api_key_name, _ = _ENVIRONMENT[target.provider]
    api_key = os.environ[api_key_name]
    engine = create_engine("sqlite://")
    for model in (models.User, models.ProviderConnection):
        table = getattr(model, "__table__", None)
        if table is None:
            raise RuntimeError("Provider reranking smoke tables are unavailable.")
        table.create(engine)
    try:
        with (
            tempfile.TemporaryDirectory(prefix="ragworks-reranking-smoke-") as temp_dir,
            Session(engine) as session,
        ):
            user = models.User(email=f"live-smoke-{uuid4()}@invalid", hashed_password="unused")
            connection = models.ProviderConnection(
                user_id=user.id,
                provider_type=ProviderType(target.provider).value,
                label="Live reranking smoke",
                config={"api_key": api_key},
            )
            session.add(user)
            session.add(connection)
            session.commit()

            # Construct the configured adapter directly before the resolver constructs
            # its run-scoped adapter. Both use production provider code.
            build_adapter(connection).reranker(target.model)
            context = _create_context(session, user, Path(temp_dir))
            original = _candidates()
            payload = RetrievalPayload(response=RetrievalResponse(matches=original))
            reranked_payload = RetrievalPayload.model_validate(
                RerankerNode(
                    RerankerConfig(connection_id=connection.id, model_name=target.model)
                ).run({"results": payload}, context)["results"]
            )
            reranked = reranked_payload.response.matches
            if len(reranked) != len(original) or set(_ordered_chunk_ids(reranked)) != set(
                _ordered_chunk_ids(original)
            ):
                raise RuntimeError("Provider reranking did not return every submitted candidate.")

            limited_payload = RetrievalPayload.model_validate(
                ResultLimitNode(ResultLimitConfig(max_results=_RESULT_LIMIT)).run(
                    {"results": reranked_payload}, context
                )["results"]
            )
            limited = limited_payload.response.matches
            if _ordered_chunk_ids(limited) != _ordered_chunk_ids(reranked)[:_RESULT_LIMIT]:
                raise RuntimeError("Result Limit did not preserve the complete reranked order.")
            return LiveSmokeResult(
                reranked_count=len(reranked),
                result_limit=_RESULT_LIMIT,
                limited_count=len(limited),
            )
    finally:
        engine.dispose()
        close_provider_clients()


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse only non-secret smoke controls."""
    parser = argparse.ArgumentParser(description="Run an opt-in provider reranking smoke test.")
    parser.add_argument("--live", action="store_true", help="permit a live provider request")
    parser.add_argument("--provider", choices=tuple(_ENVIRONMENT), required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Run the smoke path after explicit selection and complete configuration."""
    args = _parse_args(argv)
    if not args.live:
        print("Refusing live request without --live.")
        return 2
    provider: ProviderName = args.provider
    target = live_target_from_environment(provider)
    if target is None:
        print("Live reranking is not enabled or its required environment is incomplete.")
        return 2
    result = run_live_smoke(target)
    print(
        "Provider reranking smoke passed: "
        f"reranked={result.reranked_count}, result_limit={result.result_limit}, kept={result.limited_count}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
