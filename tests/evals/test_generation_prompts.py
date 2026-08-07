"""Generation prompts: steering lands in the message, media rides on it.

The builders return typed messages; the assertions here read the text a
provider would receive and, for an image context, the content parts the
request carries.
"""

from __future__ import annotations

import json

from app.evals.generation.candidates import CandidateQuestion
from app.evals.generation.contexts import ImageContext, TextContext
from app.evals.generation.prompts import (
    GENERATION_RESPONSE_FORMAT,
    IMAGE_GENERATION_RESPONSE_FORMAT,
    PromptMessage,
    build_critique_messages,
    build_generation_messages,
    generation_response_format,
)
from app.providers.chat.content import ImageUrlPart, TextPart
from app.schemas.enums import EvalQuestionType
from app.schemas.media import InlineMedia

_PAGE = InlineMedia(media_type="image/png", data=b"\x89PNG-page-bytes")


def _text_of(message: PromptMessage) -> str:
    """The text a provider reads off a message, parts or plain string."""
    if isinstance(message.content, str):
        return message.content
    return "\n".join(part.text for part in message.content if isinstance(part, TextPart))


def _images_of(message: PromptMessage) -> list[str]:
    """Every image data URI attached to a message."""
    if isinstance(message.content, str):
        return []
    return [part.image_url.url for part in message.content if isinstance(part, ImageUrlPart)]


def _messages(**overrides: object) -> list[PromptMessage]:
    kwargs: dict = {
        "context": TextContext(text="The retry budget is two attempts."),
        "question_type": EvalQuestionType.SINGLE_FACT,
        "candidates_per_context": 3,
        "audience": None,
        "example_queries": [],
        "distractor_texts": [],
    }
    kwargs.update(overrides)
    messages = build_generation_messages(**kwargs)
    assert messages[0].role == "system"
    assert messages[1].role == "user"
    return messages


class TestTextGeneration:
    """The text path, unchanged by the modality split."""

    def test_optional_steering_inputs_shape_the_prompt(self) -> None:
        """Audience, example queries, and distractors appear only when provided."""
        bare = _text_of(_messages()[1])
        assert "The people asking" not in bare
        assert "real example" not in bare
        assert "other excerpt" not in bare

        steered = _text_of(
            _messages(
                audience="Support engineers triaging incidents",
                example_queries=["why does upload fail?", "retry limits?"],
                distractor_texts=["Unrelated excerpt about billing."],
            )[1]
        )
        assert "Support engineers triaging incidents" in steered
        assert "- why does upload fail?" in steered
        assert "answerable ONLY from the context" in steered
        assert "Unrelated excerpt about billing." in steered

    def test_paraphrased_type_forbids_source_wording(self) -> None:
        """The paraphrased instruction differs from the single-fact one."""
        fact = _text_of(_messages(question_type=EvalQuestionType.SINGLE_FACT)[1])
        paraphrased = _text_of(_messages(question_type=EvalQuestionType.PARAPHRASED)[1])
        assert "WITHOUT reusing its wording" in paraphrased
        assert "WITHOUT reusing its wording" not in fact

    def test_a_text_message_stays_a_plain_string(self) -> None:
        """No attachment means no content parts — the request shape is unchanged."""
        assert isinstance(_messages()[1].content, str)

    def test_text_generation_demands_a_verbatim_quote(self) -> None:
        """The mechanical groundedness gate needs a quote to check."""
        content = _text_of(_messages()[1])
        assert '"quote"' in content
        assert "The retry budget is two attempts." in content


class TestImageGeneration:
    """The image path: the page is the payload."""

    def test_the_page_rides_on_the_user_message(self) -> None:
        """The image is attached as a content part, after the instructions."""
        message = _messages(context=ImageContext(image=_PAGE))[1]
        assert _images_of(message) == [_PAGE.data_uri()]

    def test_instructions_are_written_for_a_visual_source(self) -> None:
        """Nothing tells the model to quote a page it can only look at."""
        content = _text_of(_messages(context=ImageContext(image=_PAGE))[1])
        assert "page" in content
        assert '"quote"' not in content

    def test_question_type_instructions_are_page_specific(self) -> None:
        """Each type still steers, in wording that fits a page image."""
        fact = _text_of(
            _messages(
                context=ImageContext(image=_PAGE),
                question_type=EvalQuestionType.SINGLE_FACT,
            )[1]
        )
        multi = _text_of(
            _messages(
                context=ImageContext(image=_PAGE),
                question_type=EvalQuestionType.MULTI_DETAIL,
            )[1]
        )
        assert "labelled value on a chart" in fact
        assert "two or more distinct details" in multi

    def test_steering_still_applies(self) -> None:
        """Audience and example queries steer image questions the same way."""
        content = _text_of(
            _messages(
                context=ImageContext(image=_PAGE),
                audience="Analysts reading quarterly decks",
                example_queries=["what was Q3 churn?"],
            )[1]
        )
        assert "Analysts reading quarterly decks" in content
        assert "- what was Q3 churn?" in content

    def test_the_response_schema_drops_the_quote_field(self) -> None:
        """A page has nothing to copy verbatim, so none is asked for."""
        image_schema = generation_response_format(ImageContext(image=_PAGE))
        assert image_schema is IMAGE_GENERATION_RESPONSE_FORMAT
        assert generation_response_format(TextContext(text="x")) is GENERATION_RESPONSE_FORMAT
        assert _required_fields(image_schema) == ["question", "answer"]
        assert _required_fields(GENERATION_RESPONSE_FORMAT) == ["question", "answer", "quote"]


class TestCritique:
    """The batched critique call."""

    def test_critique_prompt_lists_candidates_in_order(self) -> None:
        """The critique call enumerates candidates and demands a JSON object."""
        content = _text_of(
            build_critique_messages(
                context=TextContext(text="ctx"),
                candidates=[
                    CandidateQuestion(question="Q1?", answer="A1", quote="q"),
                    CandidateQuestion(question="Q2?", answer="A2", quote="q"),
                ],
            )[1]
        )
        assert "1. question: Q1?" in content
        assert "2. question: Q2?" in content
        assert '"groundedness": 1-5' in content
        assert "EXCERPT:\nctx" in content

    def test_an_image_critique_carries_the_page(self) -> None:
        """Scoring groundedness against a page needs the page attached."""
        message = build_critique_messages(
            context=ImageContext(image=_PAGE),
            candidates=[CandidateQuestion(question="Q1?", answer="A1", quote="")],
        )[1]
        assert _images_of(message) == [_PAGE.data_uri()]
        content = _text_of(message)
        assert "stated in the page" in content
        assert "EXCERPT:" not in content


def _required_fields(schema: dict[str, object]) -> list[str]:
    """The candidate object's required field names, read out of the schema."""
    body = json.loads(json.dumps(schema))
    return list(body["json_schema"]["schema"]["properties"]["candidates"]["items"]["required"])
