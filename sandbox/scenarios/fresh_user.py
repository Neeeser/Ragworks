"""An account exists, but first-run setup has not started."""

from __future__ import annotations

from sandbox.builders import create_admin_user
from sandbox.context import SeedContext
from sandbox.registry import scenario


@scenario(
    name="fresh-user",
    description="Admin account exists; no providers, indexes, or collections — the setup wizard shows from its first step.",
    state=(
        "one admin user (the standard sandbox login)",
        "no provider connections, indexes, pipelines, or collections",
        "GET /api/setup/status reports nothing ready; the wizard gates the console",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Register the standard user and stop before any setup."""
    create_admin_user(ctx)
