"""What modalities a node's selected model accepts.

A model-backed node's contract is not a fixed declaration: an embedder
takes images when its model does, and the same node with a text-only model
takes text alone. Both the runtime partition and the editor's validation
resolve that here so they can never answer differently.

A provider publishing no modality list means unknown, not text-only.
Unknown resolves to the node's declared floor and validation stays silent —
a model the catalog does not describe still works, and refusing it would
make every provider without a modality block unusable for images.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from app.pipelines.ports import Facet
from app.providers.registry import ProviderResolver
from app.schemas.enums import ProviderKind
from app.services.errors import ServiceError, is_external_provider_error

logger = logging.getLogger(__name__)

#: Provider modality names, as published in a catalog, mapped onto the
#: facets a pipeline stream carries. Names outside this map (audio, video)
#: are ignored until a node produces items in that modality.
FACET_BY_MODALITY: dict[str, Facet] = {"text": Facet.TEXT, "image": Facet.IMAGE}


@dataclass(frozen=True)
class ModelModalityRule:
    """How a node's selected model governs what that node accepts.

    Declared on the node class, so nothing outside it hardcodes a type id.
    The two modes are genuinely different contracts, not a flag on one:

    - `follows_model=True` — the port's `accepts` is a floor the model
      *widens*. An embedder processes whatever its model reads, so a
      multimodal model makes the same node take images.
    - `follows_model=False` — the port's `accepts` is fixed and the model
      has to satisfy it. A vision shell processes images whichever model
      is picked; a model that cannot read them is the wrong model, and
      widening its contract would send it text it was never wired for.
    """

    kind: ProviderKind
    follows_model: bool = False


def published_facets(
    providers: ProviderResolver,
    connection_id: UUID,
    model_name: str,
    kind: ProviderKind,
) -> frozenset[str] | None:
    """Return the facets a model's published input modalities map to.

    `None` means the catalog says nothing — the caller keeps its floor.
    A lookup that fails because the provider is unreachable or rejects the
    credentials is also unknown: a node must not silently narrow what it
    processes because a catalog fetch timed out.
    """
    try:
        modalities = providers.input_modalities(connection_id, model_name, kind)
    except Exception as exc:
        if not isinstance(exc, ServiceError) and not is_external_provider_error(exc):
            raise
        logger.warning(
            "Model modalities unavailable for connection=%s model=%s: %s",
            connection_id,
            model_name,
            exc,
        )
        return None
    if not modalities:
        return None
    return frozenset(
        FACET_BY_MODALITY[modality] for modality in modalities if modality in FACET_BY_MODALITY
    )


def accepted_facets(published: frozenset[str] | None, floor: frozenset[str]) -> frozenset[str]:
    """Widen a node's declared floor by what its model additionally accepts.

    The floor is never narrowed: an embedding model whose catalog omits
    `text` still embeds text, and a node that stopped accepting its own
    primary modality over a catalog gap would skip every item it was
    wired up for.
    """
    if published is None:
        return floor
    return floor | published
