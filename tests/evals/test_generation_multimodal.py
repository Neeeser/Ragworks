"""Per-modality synthetic generation: model choice, page payloads, quote gate.

Drives the seams the generator actually uses — `resolve_connection` and
`get_provider` in `app.evals.generation.generator` for the run, and
`app.providers.registry.get_provider` for the catalog the request-time image
check reads — against a collection whose PDFs produced both text chunks and
stored page images.
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from app.db import models
from app.evals.generation import run_dataset_generation
from app.evals.generation.calls import ContextBatch, ModalityChat, generate_for_context
from app.evals.generation.contexts import (
    ContextPlan,
    GenerationContext,
    ImageContext,
    TextContext,
)
from app.evals.generation.requests import create_generation_dataset
from app.pipelines.payloads import IMAGE_ASSET_METADATA_KEY
from app.providers.chat.base import ChatRequest, ParsedChatResponse
from app.schemas.enums import (
    ChunkStrategy,
    DocumentStatus,
    EvalDatasetStatus,
    EvalModality,
    EvalQuestionType,
)
from app.schemas.evals_generation import EvalDatasetGenerateRequest, GenerationModelChoice
from app.schemas.media import InlineMedia
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage

PNG = (Path(__file__).parent.parent / "assets" / "diagram.png").read_bytes()

_EMBED_MODEL = "qwen/qwen3-embedding-0.6b"
_TEXT_MODEL = "test/model"
_IMAGE_MODEL = "vision/model"

#: Two documents holding four text and four page chunks each plan
#: `image, text, image, image, …` under this seed, so a four-question run
#: exercises both branches instead of depending on a lucky draw.
_SEED = 7

_IMAGE_QUESTIONS = [
    "What share of revenue came from renewals?",
    "Which region reported the steepest decline?",
    "How many sites were migrated in the second phase?",
    "What was the median time to first response?",
]

_TEXT_QUESTIONS = [
    "Which budget line covers embedding costs?",
    "How is the caching layer invalidated after deploys?",
    "Who signs off on rollout freezes during peak season?",
    "When does the retention window purge stored traces?",
]


# -- fixtures and doubles -------------------------------------------------------


def _user(session: Session, email: str = "mm@example.com") -> models.User:
    user = models.User(email=email, full_name="M", hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _connection(session: Session, user: models.User, label: str) -> models.ProviderConnection:
    connection = models.ProviderConnection(
        user_id=user.id,
        provider_type="openrouter",
        label=label,
        config={"api_key": "sk-test"},
    )
    session.add(connection)
    session.commit()
    session.refresh(connection)
    return connection


def _mixed_collection(
    session: Session, user: models.User, *, docs: int = 2, texts: int = 4, pages: int = 4
) -> models.Collection:
    """A collection of PDFs that produced both text chunks and page images."""
    storage = FileStorage()
    collection = models.Collection(name="Decks", user_id=user.id)
    session.add(collection)
    session.commit()
    session.refresh(collection)
    for doc_index in range(docs):
        source_path = f"collections/{collection.id}/files/{uuid4()}"
        storage.write_bytes(b"%PDF-1.7 stub", source_path)
        document = models.Document(
            collection_id=collection.id,
            user_id=user.id,
            name=f"deck-{doc_index}.pdf",
            content_type="application/pdf",
            source_path=source_path,
            status=DocumentStatus.READY,
            num_chunks=texts + pages,
            num_tokens=100,
            chunk_size=512,
            chunk_overlap=0,
            chunk_strategy=ChunkStrategy.TOKEN,
            embedding_model=_EMBED_MODEL,
        )
        session.add(document)
        session.commit()
        session.refresh(document)
        session.add_all(
            [
                *(
                    models.DocumentChunkRecord(
                        document_id=document.id,
                        collection_id=collection.id,
                        chunk_index=index,
                        text=(
                            f"Deck {doc_index} note {index} explains topic"
                            f" {doc_index}-{index} in careful detail."
                        ),
                        embedding=[],
                        chunk_size=512,
                        chunk_overlap=0,
                        chunk_strategy=ChunkStrategy.TOKEN,
                        embedding_model=_EMBED_MODEL,
                        token_count=12,
                    )
                    for index in range(texts)
                ),
                *(
                    models.DocumentChunkRecord(
                        document_id=document.id,
                        collection_id=collection.id,
                        chunk_index=texts + index,
                        text=f"[image: deck-{doc_index}.pdf, page {index + 1}]",
                        embedding=[],
                        chunk_metadata={
                            IMAGE_ASSET_METADATA_KEY: _store_page(
                                storage, collection.id, document.id, index
                            )
                        },
                        chunk_size=512,
                        chunk_overlap=0,
                        chunk_strategy=ChunkStrategy.TOKEN,
                        embedding_model=_EMBED_MODEL,
                        token_count=8,
                    )
                    for index in range(pages)
                ),
            ]
        )
        session.commit()
    return collection


def _store_page(
    storage: FileStorage, collection_id: UUID, document_id: UUID, index: int
) -> dict[str, object]:
    """Write one page image and return the asset dump its chunk carries."""
    relative = f"{storage.derived_dir(collection_id, document_id)}/page-{index}.png"
    storage.write_bytes(PNG, relative)
    return {
        "media_type": "image/png",
        "path": relative,
        "byte_size": len(PNG),
        "width": 200,
        "height": 120,
    }


def _payload(
    collection: models.Collection,
    text_connection: models.ProviderConnection,
    image_connection: models.ProviderConnection | None,
    *,
    num_questions: int = 4,
) -> EvalDatasetGenerateRequest:
    chosen = {
        EvalModality.TEXT: GenerationModelChoice(
            connection_id=text_connection.id, model_name=_TEXT_MODEL
        )
    }
    if image_connection is not None:
        chosen[EvalModality.IMAGE] = GenerationModelChoice(
            connection_id=image_connection.id, model_name=_IMAGE_MODEL
        )
    return EvalDatasetGenerateRequest(
        name="Multimodal set",
        collection_id=collection.id,
        models=chosen,
        num_questions=num_questions,
        seed=_SEED,
    )


class _RecordingChat:
    """Base chat double: records every request and scores every candidate."""

    name = "recording"

    def __init__(self) -> None:
        self.requests: list[ChatRequest] = []
        self.counter = 0

    def chat(self, request: ChatRequest) -> dict[str, object]:
        self.requests.append(request)
        prompt = _prompt_text(request)
        if "Score each candidate" in prompt:
            rows = [{"groundedness": 5, "standalone": 5, "realism": 5}] * prompt.count(
                "\n   answer: "
            )
            return {"content": json.dumps({"scores": rows})}
        return {"content": json.dumps({"candidates": self.candidates(prompt)})}

    def candidates(self, prompt: str) -> list[dict[str, str]]:
        """One candidate for the context in `prompt`."""
        raise NotImplementedError

    def parse_chat_response(self, response: dict[str, object]) -> ParsedChatResponse:
        return ParsedChatResponse(
            message={"role": "assistant", "content": response["content"]},
            usage={},
            provider="recording",
            response_model=_TEXT_MODEL,
        )


class _TextChat(_RecordingChat):
    """Answers a text context with a candidate quoting the real excerpt."""

    def candidates(self, prompt: str) -> list[dict[str, str]]:
        context = prompt.split("CONTEXT:\n", 1)[1].split("\n\nReply with", 1)[0]
        question = _TEXT_QUESTIONS[self.counter % len(_TEXT_QUESTIONS)]
        self.counter += 1
        return [{"question": question, "answer": "A topic.", "quote": context[:60]}]


class _ImageChat(_RecordingChat):
    """Answers a page with a quoteless candidate, as its schema asks."""

    def candidates(self, _prompt: str) -> list[dict[str, str]]:
        question = _IMAGE_QUESTIONS[self.counter % len(_IMAGE_QUESTIONS)]
        self.counter += 1
        return [{"question": question, "answer": "A figure on the page."}]


class _Adapter:
    """Provider-adapter double exposing only what the generator touches."""

    def __init__(self, chat: _RecordingChat) -> None:
        self._chat = chat

    def chat_provider(self) -> _RecordingChat:
        return self._chat

    def request_concurrency(self) -> int:
        return 4

    def request_pace(self, _kind: object) -> tuple[int | None, str]:
        return None, "shared"


class _CatalogAdapter:
    """Provider-adapter double answering only the published-modality question."""

    def __init__(self, modalities: frozenset[str]) -> None:
        self._modalities = modalities

    def catalog_input_modalities(self, _model: str, _kind: object) -> frozenset[str]:
        return self._modalities


class _Scope:
    """Context manager handing back the test session as a session_scope."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def __enter__(self) -> Session:
        return self._session

    def __exit__(self, *args: object) -> None:
        return None


def _wire_run(
    monkeypatch: pytest.MonkeyPatch,
    session: Session,
    chats: dict[UUID, _RecordingChat],
) -> None:
    """Stub the run's provider seam, answering per connection id.

    `resolve_connection` hands the connection id straight through so
    `get_provider` can return a different double per connection — which is
    what makes a per-modality model choice observable.
    """
    monkeypatch.setattr("app.evals.generation.generator.session_scope", lambda: _Scope(session))
    monkeypatch.setattr(
        "app.evals.generation.generator.resolve_connection",
        lambda _session, _user, connection_id: connection_id,
    )
    monkeypatch.setattr(
        "app.evals.generation.generator.get_provider",
        lambda connection_id, _kind: _Adapter(chats[connection_id]),
    )


def _wire_catalog(monkeypatch: pytest.MonkeyPatch, modalities: frozenset[str]) -> None:
    """Stub the catalog the request-time image-model check reads."""
    monkeypatch.setattr(
        "app.providers.registry.get_provider",
        lambda _connection, _kind: _CatalogAdapter(modalities),
    )


@pytest.fixture
def unknown_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every provider publishes no modality list — the common real case."""
    _wire_catalog(monkeypatch, frozenset())


def _prompt_text(request: ChatRequest) -> str:
    """The text a double reads off a request, content parts or plain string."""
    content = request.messages[-1]["content"]
    if isinstance(content, str):
        return content
    return "\n".join(part.get("text", "") for part in content if part.get("type") == "text")


def _image_urls(request: ChatRequest) -> list[str]:
    """Every image data URI on a request's last message."""
    content = request.messages[-1]["content"]
    if isinstance(content, str):
        return []
    return [part["image_url"]["url"] for part in content if part.get("type") == "image_url"]


# -- tests ----------------------------------------------------------------------


class TestRequestValidation:
    """What the route rejects before any background work starts."""

    def test_image_collection_requires_an_image_model(
        self, session: Session, unknown_catalog: None
    ) -> None:
        """Page images with no image model would be handed to a text model."""
        user = _user(session)
        collection = _mixed_collection(session, user)
        connection = _connection(session, user, "Text")

        with pytest.raises(InvalidInputError) as excinfo:
            create_generation_dataset(session, user, _payload(collection, connection, None))

        assert "image" in str(excinfo.value).lower()

    def test_a_published_text_only_image_model_is_rejected(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A catalog stating text-only input is a definite answer, and names the model."""
        user = _user(session)
        collection = _mixed_collection(session, user)
        connection = _connection(session, user, "Text")
        _wire_catalog(monkeypatch, frozenset({"text"}))

        with pytest.raises(InvalidInputError) as excinfo:
            create_generation_dataset(session, user, _payload(collection, connection, connection))

        assert _IMAGE_MODEL in str(excinfo.value)

    def test_a_published_vision_model_is_accepted(
        self, session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A catalog listing image input satisfies the check."""
        user = _user(session)
        collection = _mixed_collection(session, user)
        connection = _connection(session, user, "Text")
        _wire_catalog(monkeypatch, frozenset({"text", "image"}))

        dataset = create_generation_dataset(
            session, user, _payload(collection, connection, connection)
        )

        assert dataset.status == EvalDatasetStatus.GENERATING.value

    def test_a_provider_publishing_nothing_is_allowed_through(
        self, session: Session, unknown_catalog: None
    ) -> None:
        """Unknown is not text-only: refusing it makes most providers unusable."""
        user = _user(session)
        collection = _mixed_collection(session, user)
        connection = _connection(session, user, "Text")

        dataset = create_generation_dataset(
            session, user, _payload(collection, connection, connection)
        )

        assert dataset.status == EvalDatasetStatus.GENERATING.value

    def test_a_text_collection_needs_no_image_model(self, session: Session) -> None:
        """No page images means no image requirement and no catalog lookup."""
        user = _user(session)
        collection = _mixed_collection(session, user, pages=0)
        connection = _connection(session, user, "Text")

        dataset = create_generation_dataset(session, user, _payload(collection, connection, None))

        assert dataset.status == EvalDatasetStatus.GENERATING.value


class TestMixedModalityRun:
    """The background loop over a corpus holding both text and page images."""

    def test_each_modality_calls_the_model_configured_for_it(
        self, session: Session, monkeypatch: pytest.MonkeyPatch, unknown_catalog: None
    ) -> None:
        """A text context reaches the text model, a page reaches the vision one."""
        chats, dataset = _start_run(session, monkeypatch)

        run_dataset_generation(dataset.id)

        text_chat, image_chat = chats
        assert text_chat.requests
        assert image_chat.requests
        assert {request.model for request in text_chat.requests} == {_TEXT_MODEL}
        assert {request.model for request in image_chat.requests} == {_IMAGE_MODEL}

    def test_image_calls_carry_the_page_as_a_content_part(
        self, session: Session, monkeypatch: pytest.MonkeyPatch, unknown_catalog: None
    ) -> None:
        """The page is inlined on the generation and the critique call alike."""
        chats, dataset = _start_run(session, monkeypatch)

        run_dataset_generation(dataset.id)

        _, image_chat = chats
        urls = [url for request in image_chat.requests for url in _image_urls(request)]
        assert len(urls) == len(image_chat.requests)
        assert all(url.startswith("data:image/png;base64,") for url in urls)

    def test_text_calls_still_send_a_plain_string(
        self, session: Session, monkeypatch: pytest.MonkeyPatch, unknown_catalog: None
    ) -> None:
        """Nothing about the text path's request shape changes for existing datasets."""
        chats, dataset = _start_run(session, monkeypatch)

        run_dataset_generation(dataset.id)

        text_chat, _ = chats
        assert text_chat.requests
        assert all(
            isinstance(request.messages[-1]["content"], str) for request in text_chat.requests
        )

    def test_accepted_image_questions_are_stamped_and_quoteless(
        self, session: Session, monkeypatch: pytest.MonkeyPatch, unknown_catalog: None
    ) -> None:
        """An image query records an empty quote and its modality.

        The stamp is what a later image-query recipe reads to tell which
        stored questions came from a page rather than an excerpt.
        """
        _, dataset = _start_run(session, monkeypatch)

        run_dataset_generation(dataset.id)

        with Session(session.get_bind()) as fresh:
            stored = fresh.get(models.EvalDataset, dataset.id)
            assert stored is not None
            assert stored.status == EvalDatasetStatus.READY.value
            queries = fresh.exec(
                select(models.EvalDatasetQuery).where(
                    models.EvalDatasetQuery.dataset_id == dataset.id
                )
            ).all()
            by_modality: dict[str, list[dict[str, object]]] = {}
            for query in queries:
                metadata = query.query_metadata or {}
                by_modality.setdefault(str(metadata.get("modality")), []).append(metadata)
            assert set(by_modality) == {"text", "image"}
            assert all(metadata["quote"] == "" for metadata in by_modality["image"])
            assert all(metadata["quote"] for metadata in by_modality["text"])


class TestQuoteGate:
    """The verbatim-quote gate, at the layer that applies it."""

    def test_a_text_candidate_with_a_fabricated_quote_is_dropped(self) -> None:
        """The mechanical gate rejects an ungrounded text candidate for free."""
        chat = _StubChat(
            [
                {
                    "candidates": [
                        {
                            "question": "What is the retry budget?",
                            "answer": "two",
                            "quote": "this sentence appears nowhere in the excerpt",
                        }
                    ]
                }
            ]
        )

        batch = _run_one(chat, TextContext(text="The retry budget is two attempts."))

        assert batch.generated == 1
        assert batch.kept == []
        assert chat.calls == 1  # no critique call is worth paying for

    def test_an_image_candidate_needs_no_quote(self) -> None:
        """A page carries no quotable source, so the critique scores decide alone."""
        chat = _StubChat(
            [
                {"candidates": [{"question": "What was Q3 churn?", "answer": "4 percent"}]},
                {"scores": [{"groundedness": 5, "standalone": 5, "realism": 5}]},
            ]
        )

        batch = _run_one(chat, ImageContext(image=InlineMedia(media_type="image/png", data=PNG)))

        assert batch.generated == 1
        assert [candidate.question for candidate, _ in batch.kept] == ["What was Q3 churn?"]
        assert batch.kept[0][0].quote == ""

    def test_an_image_candidate_still_fails_a_low_critique(self) -> None:
        """Skipping the quote gate does not lower the quality bar."""
        chat = _StubChat(
            [
                {"candidates": [{"question": "What was Q3 churn?", "answer": "4 percent"}]},
                {"scores": [{"groundedness": 2, "standalone": 5, "realism": 5}]},
            ]
        )

        batch = _run_one(chat, ImageContext(image=InlineMedia(media_type="image/png", data=PNG)))

        assert batch.kept == []


class _StubChat:
    """A chat provider replying with a scripted sequence of JSON payloads."""

    name = "stub"

    def __init__(self, replies: list[dict[str, object]]) -> None:
        self._replies = list(replies)
        self.calls = 0

    def chat(self, _request: ChatRequest) -> dict[str, object]:
        reply = self._replies[self.calls]
        self.calls += 1
        return {"content": json.dumps(reply)}

    def parse_chat_response(self, response: dict[str, object]) -> ParsedChatResponse:
        return ParsedChatResponse(
            message={"role": "assistant", "content": response["content"]},
            usage={},
            provider="stub",
            response_model=_TEXT_MODEL,
        )


def _start_run(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> tuple[tuple[_TextChat, _ImageChat], models.EvalDataset]:
    """Seed a mixed collection, wire per-connection doubles, return both."""
    user = _user(session)
    collection = _mixed_collection(session, user)
    text_connection = _connection(session, user, "Text")
    image_connection = _connection(session, user, "Vision")
    dataset = create_generation_dataset(
        session, user, _payload(collection, text_connection, image_connection)
    )
    text_chat, image_chat = _TextChat(), _ImageChat()
    _wire_run(
        monkeypatch,
        session,
        {text_connection.id: text_chat, image_connection.id: image_chat},
    )
    return (text_chat, image_chat), dataset


def _run_one(chat: _StubChat, context: GenerationContext) -> ContextBatch:
    """One `generate_for_context` call over a hand-built context."""
    modality = EvalModality.IMAGE if isinstance(context, ImageContext) else EvalModality.TEXT
    config = EvalDatasetGenerateRequest(
        name="Direct",
        collection_id=uuid4(),
        models={
            EvalModality.TEXT: GenerationModelChoice(
                connection_id=uuid4(), model_name=_TEXT_MODEL
            )
        },
    )
    return generate_for_context(
        ModalityChat(chat=chat, model=_TEXT_MODEL),
        config,
        context=context,
        plan=ContextPlan(
            doc_id="doc",
            start_index=0,
            span=1,
            question_type=EvalQuestionType.SINGLE_FACT,
            modality=modality,
        ),
        distractor_snippets=[],
        accepted_texts=[],
    )
