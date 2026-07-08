"""Public runtime config API route.

Unauthenticated on purpose: the frontend needs the public config subset
(registration policy, upload limits, feature flags) before a user has
signed in at all, to render the sign-up page and gate UI affordances.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas.app_config import PublicConfig
from app.services.app_config import get_app_config

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("", response_model=PublicConfig)
def get_public_config() -> PublicConfig:
    """Return the public subset of the effective runtime config."""
    return PublicConfig.from_app_config(get_app_config())
