"""Provider adapters: pluggable model providers behind per-user connections.

Public API: the adapter base + registry. Adapter implementations are imported
from their own modules by the registry; consumers go through
`app.providers.registry`.
"""

from app.providers.base import ProviderAdapter, ProviderDescriptor
from app.providers.registry import ProviderResolver, get_provider, resolve_connection

__all__ = [
    "ProviderAdapter",
    "ProviderDescriptor",
    "ProviderResolver",
    "get_provider",
    "resolve_connection",
]
