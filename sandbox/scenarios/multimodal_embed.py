"""Images and text in one vector space, with no descriptions in between."""

from __future__ import annotations

from sandbox import config
from sandbox.builders import (
    SAMPLE_DOCUMENTS,
    add_provider_connection,
    bind_shared_space_ingestion,
    bootstrap_setup,
    create_admin_user,
    create_pgvector_index,
    ingest_assets,
    ingest_media,
)
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.multimodal import MEDIA_FILES


@scenario(
    name="multimodal-embed",
    description=(
        "A collection whose images are embedded directly by an image-capable model "
        "rather than described first — a text query reaches an image through the "
        "shared vector space, with no prose in between."
    ),
    requires=("cohere",),
    state=(
        "one admin user (the standard sandbox login)",
        "a live-validated Cohere connection serving embed-v4.0 (override with "
        "SANDBOX_MM_PROVIDER / SANDBOX_MM_EMBEDDING_MODEL)",
        "a pgvector index sized to that model, holding text and image vectors together",
        'pipeline "Multimodal embedding" bound as the collection\'s ingestion pipeline: '
        "chunks, PDF figures, and uploaded images all embed through the same model",
        "three text documents plus galactic-center.jpg and solar-figures.pdf, all ready",
        "searching for what an image depicts returns it with no description anywhere "
        "in the pipeline — the image vector itself is the match",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Seed a collection whose whole corpus lives in one multimodal vector space."""
    model = config.multimodal_embedding_model()
    create_admin_user(ctx)
    add_provider_connection(ctx, config.multimodal_embedding_provider())
    index_name, dimension = create_pgvector_index(ctx, embedding_model=model)
    bootstrap_setup(
        ctx,
        index_name=index_name,
        embedding_dimension=dimension,
        embedding_model=model,
    )
    ingest_assets(ctx, filenames=SAMPLE_DOCUMENTS)
    bind_shared_space_ingestion(
        ctx, index_name=index_name, dimension=dimension, embedding_model=model
    )
    ingest_media(ctx, files=MEDIA_FILES)
