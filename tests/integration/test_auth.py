from __future__ import annotations


def test_user_registration_cycle(user_context: dict[str, object]) -> None:
    profile = user_context["user"]
    creds = user_context["credentials"]
    assert profile["email"] == creds["email"]
    assert profile["is_active"] is True
    assert "id" in profile and profile["id"]
