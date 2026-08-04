"""`providers.max_retry_attempts` actually bounds retries at the enforcement
site -- not just in `AppConfigService.effective_config()`.

`resolve_retry_policy()` is the one place the config value is read; this
pins that an override changes what `call_with_retries` (the real
enforcement site every throttled proxy and the LLM engine call through)
actually does, not merely what the config object reports.
"""

from __future__ import annotations

from collections.abc import Iterator

import httpx
import pytest
from sqlmodel import Session

from app.db.repositories import AppSettingRepository
from app.providers.throttle import call_with_retries, resolve_retry_policy
from app.services.app_config import invalidate_app_config_cache


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    """Ensure `get_app_config`'s process-wide cache never leaks across tests."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _http_status_error(status: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://provider.test/chat")
    response = httpx.Response(status, request=request)
    return httpx.HTTPStatusError("boom", request=request, response=response)


def test_default_resolves_to_five_attempts(session: Session) -> None:
    assert resolve_retry_policy().attempts == 5


def test_overriding_the_knob_changes_the_attempts_actually_enforced(
    session: Session,
) -> None:
    """Not just `effective_config()` -- the object `call_with_retries` runs on."""
    AppSettingRepository(session).upsert("providers.max_retry_attempts", 2, updated_by=None)
    session.commit()
    invalidate_app_config_cache()
    try:
        policy = resolve_retry_policy()
        assert policy.attempts == 2

        calls = {"n": 0}

        def flaky() -> str:
            calls["n"] += 1
            if calls["n"] < 3:
                raise _http_status_error(429)
            return "ok"

        # A call needing 3 tries to succeed must fail when only 2 are
        # allowed -- proving the resolved policy, not the old hardcoded
        # default of 5 (which would have let this succeed), governs here.
        with pytest.raises(httpx.HTTPStatusError):
            call_with_retries(flaky, policy=policy, sleep=lambda _: None)
        assert calls["n"] == 2
    finally:
        AppSettingRepository(session).delete("providers.max_retry_attempts")
        session.commit()
        invalidate_app_config_cache()
