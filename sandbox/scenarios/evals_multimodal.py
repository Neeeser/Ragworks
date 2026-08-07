"""Measuring an image collection: an image corpus, image queries, and a run."""

from __future__ import annotations

from sandbox.builders import seed_image_eval_dataset, seed_image_eval_run
from sandbox.context import SeedContext
from sandbox.registry import scenario
from sandbox.scenarios.multimodal_embed import seed as seed_multimodal_embed


@scenario(
    name="evals-multimodal",
    description=(
        "multimodal-embed plus an eval dataset whose corpus documents are page images "
        "and whose queries include one asked with a picture — a completed run over it "
        "scores image retrieval end to end."
    ),
    requires=("cohere",),
    state=(
        "everything from multimodal-embed (Cohere embed-v4.0, a shared text/image "
        "vector space, five ready documents)",
        'eval dataset "Sandbox Image Eval Dataset" (ready, modalities image + text): 4 '
        "corpus documents carrying image media and no text — galactic-center.jpg plus "
        "three generated figure pages — with 5 queries and one relevance judgment each",
        "4 of those queries are text asking for what a page shows; the fifth carries no "
        "text at all, only the galactic-centre photograph, and its gold document is the "
        "corpus page holding that same image",
        'eval run "Image corpus run" (completed): the corpus ingested through the '
        '"Multimodal embedding" pipeline and queried through the collection\'s primary '
        "search tool, so metrics, the funnel, and per-query results are all populated",
        "starting another run over this dataset with the same ingestion pipeline "
        "reuses that eval collection, so it scores without re-ingesting the images",
    ),
)
def seed(ctx: SeedContext) -> None:
    """Compose multimodal-embed, then measure it with an image eval dataset."""
    seed_multimodal_embed(ctx)
    dataset = seed_image_eval_dataset(ctx)
    seed_image_eval_run(ctx, dataset=dataset)
