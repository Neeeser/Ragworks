"""What modalities a model reads, for providers that publish nothing.

Split from `registry.py` because this is model *metadata* resolution, not
adapter construction — and because a probe with a cache is a unit worth
reading in one place.
"""

from __future__ import annotations

import base64
import logging
from uuid import UUID

from app.cache import CachePolicy, ValueCache
from app.providers.base import ProviderAdapter
from app.schemas.enums import ProviderKind
from app.schemas.media import InlineMedia

logger = logging.getLogger(__name__)

#: Whether a model accepts image input, keyed by connection and model.
#: Retained including a negative answer — a model that cannot read images is
#: as settled a fact as one that can, and re-probing it on every validation
#: debounce is the runaway this cache exists to prevent.
_image_support_cache = ValueCache[tuple[UUID, str], bool](
    CachePolicy(
        fresh_seconds=300,
        max_stale_seconds=3600,
        failure_retry_seconds=30,
        max_entries=1024,
    )
)


#: A 1x1 PNG, the smallest thing that is unambiguously an image. Sent only
#: to ask whether a model accepts image input at all, so its content is
#: irrelevant and its size keeps the probe cheap.
_PROBE_IMAGE = InlineMedia(
    media_type="image/png",
    data=base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    ),
)


def resolve_embedding_modalities(
    adapter: ProviderAdapter,
    connection_id: UUID,
    model_id: str,
) -> frozenset[str]:
    """Return what an embedding model reads: published if stated, else probed.

    Catalog first, for the same reason width resolution reads it first — it
    is free and exact where a provider states it. But no provider publishes
    modalities for embedding models today (OpenRouter states none for any of
    the 31 it serves, several of which are genuinely multimodal), so a
    catalog-only answer leaves every multimodal embedding model unreachable:
    the node would keep its text floor and route images nowhere.

    The probe closes that gap by embedding one 1x1 PNG. It is safe on the
    validation path only because the answer is cached including the negative
    one, and it is reached at all only when a stream actually holds items the
    text floor left out — a text-only pipeline never probes.
    """
    published = adapter.catalog_input_modalities(model_id, ProviderKind.EMBEDDING)
    if published:
        return published
    if _image_support_cache.get(
        (connection_id, model_id), lambda: _probe_image_support(adapter, model_id)
    ).value:
        return frozenset({"text", "image"})
    return frozenset()


def _probe_image_support(adapter: ProviderAdapter, model_id: str) -> bool:
    """Ask a model to embed one tiny image; a refusal is the negative answer.

    A provider rejecting image input answers with its own error, so any
    failure reads as "does not accept images" rather than propagating — the
    caller's fallback (the node's text floor) is what a failed probe should
    produce, and raising here would fail a pipeline save over a capability
    question.
    """
    try:
        return bool(adapter.embedder(model_id).embed_images([_PROBE_IMAGE]))
    except Exception:
        logger.debug("Image-input probe refused for model=%s", model_id)
        return False


def invalidate_image_support(connection_id: UUID) -> int:
    """Drop probe answers owned by one changed or deleted connection."""
    return _image_support_cache.invalidate_matching(lambda key: key[0] == connection_id)
