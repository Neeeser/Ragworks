"""Pinecone backend: adapts the typed SDK client in `app/clients/pinecone`."""

from app.vectorstores.pinecone.store import PINECONE_CAPABILITIES, PineconeStore

__all__ = ["PINECONE_CAPABILITIES", "PineconeStore"]
