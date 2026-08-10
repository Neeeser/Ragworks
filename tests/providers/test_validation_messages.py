"""The upstream-detail contract of connection-validation failure messages.

Regression: a non-auth upstream failure reported a bare "<provider>
validation failed." with no status or provider error text, so a transient
502, a proxy misroute, and a malformed request all read identically.
"""

from __future__ import annotations

from app.providers.base import validation_failure_message


def test_json_error_message_is_surfaced_with_the_status() -> None:
    body = '{"error": {"message": "The server had an error processing your request."}}'
    assert validation_failure_message("OpenAI", 500, body) == (
        "OpenAI validation failed (HTTP 500): "
        "The server had an error processing your request."
    )


def test_flat_detail_and_message_keys_are_read_too() -> None:
    assert validation_failure_message("Cohere", 429, '{"message": "rate limited"}').endswith(
        "(HTTP 429): rate limited"
    )
    assert validation_failure_message("TEI", 422, '{"detail": "bad payload"}').endswith(
        "(HTTP 422): bad payload"
    )


def test_short_plain_text_bodies_pass_through() -> None:
    assert validation_failure_message("TEI", 503, "model warming up").endswith(
        "(HTTP 503): model warming up"
    )


def test_unusable_bodies_fall_back_to_the_status_alone() -> None:
    assert validation_failure_message("OpenAI", 502, "") == "OpenAI validation failed (HTTP 502)."
    long_html = "<html>" + "x" * 600 + "</html>"
    assert (
        validation_failure_message("OpenAI", 502, long_html)
        == "OpenAI validation failed (HTTP 502)."
    )
    assert (
        validation_failure_message("OpenAI", 500, '{"error": {"code": 17}}')
        == "OpenAI validation failed (HTTP 500)."
    )


def test_page_long_detail_is_truncated_to_one_line() -> None:
    body = '{"error": {"message": "' + "a" * 300 + '"}}'
    message = validation_failure_message("OpenRouter", 500, body)
    assert len(message) < 260
    assert message.endswith("…")
