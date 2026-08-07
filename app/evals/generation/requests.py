"""Request-time validation and row creation for synthetic generation.

Everything that can be rejected before background work starts is rejected
here, with typed domain errors: collection ownership and generability, that
every chosen connection exists and serves chat, and that a collection holding
page images was given a model able to read them. The heavy lifting happens
later in `generator.run_dataset_generation`, which the route schedules.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository, DocumentRepository, EvalDatasetRepository
from app.evals.generation.sources import has_image_chunks
from app.pipelines.model_modality_rules import published_facets
from app.pipelines.ports import Facet
from app.providers.registry import ProviderResolver
from app.schemas.enums import (
    DocumentStatus,
    EvalDatasetSource,
    EvalDatasetStatus,
    EvalModality,
    ProviderKind,
    RelevanceGranularity,
)
from app.schemas.evals_generation import EvalDatasetGenerateRequest, GenerationModelChoice
from app.services.errors import InvalidInputError, NotFoundError


def create_generation_dataset(
    session: Session, user: models.User, payload: EvalDatasetGenerateRequest
) -> models.EvalDataset:
    """Validate a generate request and record the `generating` dataset row.

    The caller schedules `run_dataset_generation`; this only verifies the
    inputs and records the intent, mirroring `EvalService.import_builtin`.
    """
    collection = CollectionRepository(session).get(payload.collection_id, user.id)
    if collection is None:
        raise NotFoundError("Collection not found.")
    if collection.system_purpose is not None:
        raise InvalidInputError("Eval collections cannot seed synthetic datasets.")
    documents = DocumentRepository(session).list_for_collection(collection.id)
    ready = [doc for doc in documents if doc.status == DocumentStatus.READY and doc.num_chunks > 0]
    if not ready:
        raise InvalidInputError("The collection has no ingested documents to generate from.")
    _validate_models(session, user, payload, ready)
    dataset = EvalDatasetRepository(session).add(
        models.EvalDataset(
            user_id=user.id,
            name=payload.name,
            description=payload.description,
            source=EvalDatasetSource.SYNTHETIC.value,
            source_ref=str(collection.id),
            relevance_granularity=RelevanceGranularity.DOCUMENT.value,
            status=EvalDatasetStatus.GENERATING.value,
            progress_total=payload.num_questions,
            generation_config=payload.model_dump(mode="json"),
        )
    )
    session.commit()
    session.refresh(dataset)
    return dataset


def _validate_models(
    session: Session,
    user: models.User,
    payload: EvalDatasetGenerateRequest,
    documents: list[models.Document],
) -> None:
    """Check every configured model resolves, and that page images have one.

    A collection whose chunks carry page images needs a model that reads
    them: a text-only model is handed an image it cannot see, and without
    this check the failure only surfaces once the background run has spent
    its way through the corpus.
    """
    providers = ProviderResolver(user, session)
    for choice in payload.models.values():
        # Resolves the connection (404 on another user's) and enforces that
        # it serves chat, both before any row is written.
        providers.adapter(choice.connection_id, ProviderKind.CHAT)
    if not has_image_chunks(session, documents):
        return
    image = payload.models.get(EvalModality.IMAGE)
    if image is None:
        raise InvalidInputError(
            "This collection contains page images. Choose a model for the image"
            " modality as well as the text one."
        )
    _require_image_input(providers, image)


def _require_image_input(providers: ProviderResolver, choice: GenerationModelChoice) -> None:
    """Reject an image model whose provider publishes no image input.

    A provider that publishes nothing is allowed through: most catalogs carry
    no modality list at all, so refusing unknowns would leave almost every
    provider unusable for images.
    """
    published = published_facets(
        providers, choice.connection_id, choice.model_name, ProviderKind.CHAT
    )
    if published is not None and Facet.IMAGE not in published:
        raise InvalidInputError(
            f"Model '{choice.model_name}' does not accept image input. Choose a"
            " model that reads images for the image modality."
        )
