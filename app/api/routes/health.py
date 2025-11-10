from __future__ import annotations

from fastapi import APIRouter

from app.utils.time import utc_now

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def healthcheck() -> dict[str, str]:
    timestamp = utc_now().isoformat().replace("+00:00", "Z")
    return {"status": "ok", "timestamp": timestamp}
