"""Startup migration for the insights surface.

Two one-time fixes for deployments upgrading from the UMAP-era Visualize
page:

- The `features.umap_visualizations` override key becomes
  `features.collection_insights`, so an admin's explicit off switch keeps
  meaning off.
- The `umap_projections`/`umap_points` tables are dropped. Startup schema
  sync only ever adds, so removed models leave orphaned tables behind;
  their contents are derived data any refresh rebuilds in the new shape.

Both operate on raw SQL: the models they touch no longer exist.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlmodel import Session, col, select

from app.db import models

_OLD_FLAG_KEY = "features.umap_visualizations"
_NEW_FLAG_KEY = "features.collection_insights"


def migrate_insight_settings(session: Session) -> None:
    """Carry the renamed feature-flag override forward and drop dead tables."""
    old = session.exec(
        select(models.AppSetting).where(col(models.AppSetting.key) == _OLD_FLAG_KEY)
    ).first()
    if old is not None:
        new = session.exec(
            select(models.AppSetting).where(col(models.AppSetting.key) == _NEW_FLAG_KEY)
        ).first()
        if new is None:
            session.add(
                models.AppSetting(key=_NEW_FLAG_KEY, value=old.value, updated_by=old.updated_by)
            )
        session.delete(old)
        session.flush()
    session.execute(text("DROP TABLE IF EXISTS umap_points"))
    session.execute(text("DROP TABLE IF EXISTS umap_projections"))
