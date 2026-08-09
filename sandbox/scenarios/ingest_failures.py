"""A collection carrying files that failed to ingest, waiting on a retry."""

from __future__ import annotations

from sandbox.builders import upload_unindexable_files, upload_unsupported_image
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.collection_ready import seed as seed_collection_ready


@scenario(
    name="ingest-failures",
    description="collection-ready plus three uploads that failed to ingest — the state the Files page's retry-failed action clears.",
    requires=("openrouter",),
    state=(
        "everything from collection-ready",
        "3 additional files (outage-1..3.pdf, bytes that are not a PDF) in "
        "`failed` state with the parse handler's real error, holding no chunks",
        "the Files page shows the failed-files notice and its 'Retry failed files' action",
        "aurora-orbit-diagram.png force-ingested through the text-only pipeline: "
        "document `unsupported`, run `unsupported` with every node completed and "
        "the parse node skipped — the handoff links its run trace",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose collection-ready, then add uploads that cannot be indexed."""
    seed_collection_ready(ctx)
    upload_unindexable_files(ctx)
    upload_unsupported_image(ctx)
