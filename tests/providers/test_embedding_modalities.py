"""What an embedding model reads: published if stated, measured if not.

No provider publishes modalities for embedding models today, so a
catalog-only answer would leave every multimodal embedding model
unreachable — the embedder node would keep its text floor and route images
nowhere. These pin the resolution order and the caching that makes probing
safe on the validation path.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.providers.modalities import invalidate_image_support, resolve_embedding_modalities
from app.schemas.enums import ProviderKind
from app.schemas.media import InlineMedia


class _Adapter:
    """A provider adapter stub recording what the resolver asked it."""

    def __init__(self, *, published: frozenset[str], accepts_images: bool) -> None:
        self._published = published
        self._accepts_images = accepts_images
        self.probes = 0

    def catalog_input_modalities(self, model_name: str, kind: ProviderKind) -> frozenset[str]:
        del model_name, kind
        return self._published

    def embedder(self, model_name: str, dimensions: int | None = None) -> Any:
        del model_name, dimensions
        return self

    def embed_images(self, images: list[InlineMedia]) -> list[list[float]]:
        self.probes += 1
        if not self._accepts_images:
            raise RuntimeError("this model does not accept image input")
        return [[0.1, 0.2] for _ in images]


@pytest.fixture
def connection_id() -> Iterator[UUID]:
    """A fresh connection id per test, with its probe answers dropped after.

    The probe cache is process state keyed by connection and model, so a
    shared id would let one test's answer decide the next test's result.
    """
    identifier = uuid4()
    yield identifier
    invalidate_image_support(identifier)


def test_a_published_modality_list_is_trusted_without_probing(connection_id: UUID) -> None:
    adapter = _Adapter(published=frozenset({"text", "image"}), accepts_images=True)

    resolved = resolve_embedding_modalities(adapter, connection_id, "stated-multimodal")

    assert resolved == frozenset({"text", "image"})
    assert adapter.probes == 0


def test_an_unpublished_model_is_probed_and_reports_image_support(connection_id: UUID) -> None:
    """The case every real provider is in: the catalog says nothing."""
    adapter = _Adapter(published=frozenset(), accepts_images=True)

    resolved = resolve_embedding_modalities(adapter, connection_id, "silent-multimodal")

    assert resolved == frozenset({"text", "image"})
    assert adapter.probes == 1


def test_a_refused_probe_reports_no_image_support(connection_id: UUID) -> None:
    adapter = _Adapter(published=frozenset(), accepts_images=False)

    assert resolve_embedding_modalities(adapter, connection_id, "text-only") == frozenset()
    assert adapter.probes == 1


def test_the_negative_answer_is_cached_so_validation_never_reprobes(
    connection_id: UUID,
) -> None:
    """Validation re-resolves on a debounce; a dropped negative is a live call per keystroke."""
    adapter = _Adapter(published=frozenset(), accepts_images=False)

    for _ in range(5):
        assert resolve_embedding_modalities(adapter, connection_id, "text-only") == frozenset()

    assert adapter.probes == 1
