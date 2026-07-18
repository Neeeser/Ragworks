"""Hugging Face Text Embeddings Inference client public API."""

from app.clients.tei.client import (
    TEIClient,
    close_tei_clients,
    get_tei_client,
    invalidate_tei_client,
)
from app.clients.tei.schemas import TEIInfo, TEIRerankResult

__all__ = [
    "TEIClient",
    "TEIInfo",
    "TEIRerankResult",
    "close_tei_clients",
    "get_tei_client",
    "invalidate_tei_client",
]
