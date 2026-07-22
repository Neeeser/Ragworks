"""An empty application: nothing seeded at all."""

from __future__ import annotations

from sandbox.context import SeedContext
from sandbox.registry import scenario


@scenario(
    name="blank",
    description="Empty database — for testing registration, login, and the setup wizard itself.",
    state=(
        "no users (the first account registered becomes admin)",
        "no provider connections, indexes, pipelines, or collections",
        "the frontend lands on signup; after login the setup wizard gates the console",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed nothing: the reset database is the scenario."""
