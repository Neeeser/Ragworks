"""Request-time validation and row creation for synthetic generation.

Everything that can be rejected before background work starts is rejected
here, with typed domain errors: collection ownership and generability, and
that the chosen connection exists and serves chat. The heavy lifting happens
later in `generator.run_dataset_generation`, which the route schedules.
"""

from __future__ import annotations

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository, DocumentRepository, EvalDatasetRepository
from app.providers.registry import get_provider, resolve_connection
from app.schemas.enums import (
    DocumentStatus,
    EvalDatasetSource,
    EvalDatasetStatus,
    ProviderKind,
    RelevanceGranularity,
)
from app.schemas.evals_generation import EvalDatasetGenerateRequest
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
    if not any(
        doc.status == DocumentStatus.READY and doc.num_chunks > 0 for doc in documents
    ):
        raise InvalidInputError(
            "The collection has no ingested documents to generate from."
        )
    connection = resolve_connection(session, user, payload.connection_id)
    get_provider(connection, ProviderKind.CHAT)  # kind mismatch -> 400 before any work
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
