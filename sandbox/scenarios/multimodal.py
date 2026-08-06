"""A collection whose corpus is images as well as prose."""

from __future__ import annotations

from sandbox.builders import (
    SAMPLE_DOCUMENTS,
    add_openrouter_connection,
    bind_multimodal_ingestion,
    bootstrap_setup,
    create_admin_user,
    create_pgvector_index,
    ingest_assets,
    ingest_media,
)
from sandbox.context import SeedContext
from sandbox.registry import scenario

MEDIA_FILES = (
    ("galactic-center.jpg", "image/jpeg"),
    ("solar-figures.pdf", "application/pdf"),
)


@scenario(
    name="multimodal",
    description=(
        "A collection ingesting images as well as prose: an uploaded photograph and a "
        "PDF whose figures are extracted, described by a vision model, and indexed "
        "beside the text."
    ),
    requires=("openrouter",),
    state=(
        "everything from collection-ready (connection, indexes, three text documents)",
        'pipeline "Multimodal ingestion" bound as the collection\'s ingestion pipeline: '
        "Extract Text, Extract Media, and Media File parsing the uploaded file in "
        "parallel, merged into one chunk/describe/embed/index chain",
        "galactic-center.jpg — a NASA composite of the galactic centre, read by the "
        "Media File node and searchable by what a vision model saw in it",
        "solar-figures.pdf — text extracted and chunked, plus two embedded figures (a "
        "solar flare image and a labelled sunspot chart) pulled out, described, and "
        "indexed alongside it",
        "searching for what the images depict returns them, so the describe-then-embed "
        "path can be checked end to end",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Build a wizard-complete collection, then re-point ingestion at the image graph."""
    create_admin_user(ctx)
    add_openrouter_connection(ctx)
    index_name, dimension = create_pgvector_index(ctx)
    bootstrap_setup(ctx, index_name=index_name, embedding_dimension=dimension)
    ingest_assets(ctx, filenames=SAMPLE_DOCUMENTS)
    bind_multimodal_ingestion(ctx, index_name=index_name, dimension=dimension)
    ingest_media(ctx, files=MEDIA_FILES)
