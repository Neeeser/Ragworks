"""Typed Pinecone SDK client factory and control-plane index admin.

Behavior here is pinned to the installed SDK (`pinecone==8.0.0`, per `uv.lock`) --
verified by reading `external_api_documentation/pinecone-docs/reference/python-sdk.md`
and by introspecting the installed package directly, not by feature-detecting at
runtime. See `app/AGENTS.md` for the resulting rule.
"""

from __future__ import annotations

from pinecone import Pinecone, ServerlessSpec  # pylint: disable=no-name-in-module

from app.clients.pinecone.types import IndexDescription


def get_pinecone_client(api_key: str) -> Pinecone:
    """Return a Pinecone SDK client for the given API key.

    Unlike `app.clients.openrouter.get_openrouter_client`, this does not cache
    instances: the installed SDK's `Pinecone` client exposes no `close()` method, so
    there is no connection pool an eviction would need to release.
    """
    resolved = (api_key or "").strip()
    if not resolved:
        raise ValueError("Pinecone API key must be provided.")
    return Pinecone(api_key=resolved)


class PineconeIndexAdmin:
    """Typed wrapper over Pinecone's control-plane (index admin) operations.

    Wraps `Pinecone.list_indexes`/`describe_index`/`create_index`/`delete_index` and
    returns/accepts typed values instead of raw SDK models or `Any`-typed dicts. Data-
    plane operations (upsert/query against a specific index's data) are out of scope
    here -- those stay with the indexer/retriever, which hold an `Index` handle.
    """

    def __init__(self, client: Pinecone) -> None:
        """Wrap an already-constructed Pinecone SDK client."""
        self._client = client

    def list_indexes(self) -> list[IndexDescription]:
        """Return typed descriptions for every index visible to this client.

        `Pinecone.list_indexes()` returns an `IndexList`, which is directly iterable
        over `IndexModel` entries (confirmed by reading the installed SDK's
        `pinecone.db_control.models.index_list.IndexList.__iter__`) -- no
        dict-vs-object shape detection needed.
        """
        return [IndexDescription.from_sdk(index) for index in self._client.list_indexes()]

    def describe_index(self, name: str) -> IndexDescription:
        """Return the typed description for a single index."""
        return IndexDescription.from_sdk(self._client.describe_index(name))

    # pylint: disable-next=too-many-arguments
    def create_index(
        self,
        *,
        name: str,
        vector_type: str,
        metric: str,
        cloud: str,
        region: str,
        dimension: int | None = None,
        deletion_protection: str | None = None,
        tags: dict[str, str] | None = None,
    ) -> IndexDescription:
        """Create a serverless index and return its freshly described state.

        `dimension`/`deletion_protection`/`tags` are passed through as `None` when
        unset rather than conditionally omitted from the call: the installed SDK's
        `PineconeDBControlRequestFactory.create_index_request` drops `None`-valued
        args via `parse_non_empty_args` before building the request, so passing
        `None` explicitly and omitting the keyword entirely are behaviorally
        identical (confirmed by reading that factory's source, not assumed).
        """
        self._client.create_index(
            name=name,
            metric=metric,
            spec=ServerlessSpec(cloud=cloud, region=region),
            vector_type=vector_type,
            dimension=dimension,
            deletion_protection=deletion_protection,
            tags=tags,
        )
        return self.describe_index(name)

    def delete_index(self, name: str) -> None:
        """Delete an index by name."""
        self._client.delete_index(name)
