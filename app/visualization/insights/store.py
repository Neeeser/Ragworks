"""On-disk model bundles for incremental insight updates.

The fitted PaCMAP reducer (and, for lexical spaces, the fitted TF-IDF+SVD
transformer) must survive between ingestions so new chunks can be placed
into the existing layout without refitting. Bundles are machine-generated
state that must exist independent of the database, so they live under
`config_path` (never `storage_path`, which is bulk-reclaimable uploads).

The basis matrix is deliberately not stored: for semantic spaces it is
rebuilt from the chunk embeddings already in Postgres, and for lexical
spaces from chunk text through the pickled transformer — storing it would
duplicate the corpus's vectors on disk at full width.
"""

from __future__ import annotations

import pickle
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sklearn.pipeline import Pipeline as SkPipeline

from app.core.config import get_settings
from app.schemas.enums import InsightSpace
from app.visualization.insights.engine import Projector

_BUNDLE_DIR = "insights"


@dataclass
class InsightModelBundle:
    """Everything needed to place new vectors into a stored projection."""

    snapshot_id: UUID
    space: InsightSpace
    reducer: Projector
    # Row order of the fitted basis; embeddings/text re-fetched by these ids
    # must be stacked in exactly this order to reproduce the basis.
    fitted_chunk_ids: list[UUID]
    lexical_transformer: SkPipeline | None


def _bundle_path(collection_id: UUID) -> Path:
    return get_settings().config_path / _BUNDLE_DIR / f"{collection_id}.pkl"


def save_bundle(collection_id: UUID, bundle: InsightModelBundle) -> None:
    """Persist a collection's model bundle, replacing any previous one."""
    path = _bundle_path(collection_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".pkl.tmp")
    with tmp.open("wb") as handle:
        pickle.dump(bundle, handle)
    tmp.replace(path)


def load_bundle(collection_id: UUID, snapshot_id: UUID) -> InsightModelBundle | None:
    """Load the bundle matching a snapshot; None when absent or mismatched.

    A bundle from a different snapshot describes a projection the database
    no longer holds — treating it as usable would transform new points into
    a layout the map is not showing.
    """
    path = _bundle_path(collection_id)
    if not path.exists():
        return None
    try:
        with path.open("rb") as handle:
            bundle = pickle.load(handle)
    except Exception:
        return None
    if not isinstance(bundle, InsightModelBundle) or bundle.snapshot_id != snapshot_id:
        return None
    return bundle


def delete_bundle(collection_id: UUID) -> None:
    """Remove a collection's bundle (collection deletion, failed rebuilds)."""
    _bundle_path(collection_id).unlink(missing_ok=True)
