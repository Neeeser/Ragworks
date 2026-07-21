"""Candidate parsing and the mechanical gates: quote match, dedup, critiques."""

from __future__ import annotations

from app.evals.generation.candidates import (
    CritiqueScores,
    is_duplicate_question,
    parse_candidates,
    parse_critiques,
    quote_matches,
)

_CONTEXT = (
    "The Treaty of Utrecht was signed in April 1713. It ended the War of the"
    " Spanish Succession and redrew the colonial map: Britain gained Gibraltar"
    " and Menorca from Spain, plus extensive territories in North America."
)


class TestParseCandidates:
    """Tolerant JSON extraction from generation replies."""

    def test_parses_structured_output_object(self) -> None:
        """The structured-outputs contract — a `candidates` wrapper — is the primary path."""
        raw = (
            '{"candidates": [{"question": "When was the Treaty of Utrecht signed?",'
            ' "answer": "April 1713", "quote": "signed in April 1713"}]}'
        )
        candidates = parse_candidates(raw)
        assert len(candidates) == 1
        assert candidates[0].answer == "April 1713"

    def test_parses_plain_json_array(self) -> None:
        """A clean array yields every well-formed candidate."""
        raw = (
            '[{"question": "When was the Treaty of Utrecht signed?",'
            ' "answer": "April 1713", "quote": "signed in April 1713"}]'
        )
        candidates = parse_candidates(raw)
        assert len(candidates) == 1
        assert candidates[0].question == "When was the Treaty of Utrecht signed?"

    def test_parses_fenced_array_with_prose(self) -> None:
        """Code fences and surrounding prose are tolerated."""
        raw = (
            "Here you go!\n```json\n"
            '[{"question": "Q1?", "answer": "A1", "quote": "quote one"},'
            ' {"question": "Q2?", "answer": "A2", "quote": "quote two"}]'
            "\n```\nHope that helps."
        )
        assert len(parse_candidates(raw)) == 2

    def test_malformed_items_are_dropped_not_fatal(self) -> None:
        """Items missing a question or quote vanish; the rest survive."""
        raw = (
            '[{"question": "Valid?", "quote": "signed in April"},'
            ' {"question": "", "quote": "x"}, {"answer": "only"}, "junk"]'
        )
        candidates = parse_candidates(raw)
        assert [candidate.question for candidate in candidates] == ["Valid?"]

    def test_no_array_returns_empty(self) -> None:
        """A reply with no JSON array yields zero candidates, not an error."""
        assert parse_candidates("I cannot answer that.") == []


class TestQuoteMatch:
    """The verbatim-quote groundedness gate."""

    def test_exact_quote_matches(self) -> None:
        """A verbatim excerpt passes."""
        assert quote_matches("Britain gained Gibraltar and Menorca", _CONTEXT)

    def test_whitespace_and_case_are_normalized(self) -> None:
        """Case and whitespace differences do not fail a real quote."""
        assert quote_matches("britain  gained gibraltar\nand menorca", _CONTEXT)

    def test_invented_quote_fails(self) -> None:
        """A quote that is not in the context is rejected."""
        assert not quote_matches(
            "France ceded its entire navy to the Dutch Republic", _CONTEXT
        )

    def test_lightly_garbled_quote_still_matches(self) -> None:
        """A small transcription slip inside a long real quote passes."""
        assert quote_matches(
            "It ended the War of the Spannish Succession and redrew the"
            " colonial map",
            _CONTEXT,
        )


class TestDedup:
    """Near-duplicate question detection."""

    def test_repeated_question_is_duplicate(self) -> None:
        """The same question with trivial rewording registers as duplicate."""
        accepted = ["When was the Treaty of Utrecht signed?"]
        assert is_duplicate_question(
            "When was the treaty of Utrecht signed", accepted
        )

    def test_word_shuffle_is_duplicate(self) -> None:
        """Token-set similarity catches reordered phrasings."""
        accepted = ["What territories did Britain gain from Spain?"]
        assert is_duplicate_question(
            "From Spain, what territories did Britain gain?", accepted
        )

    def test_distinct_question_is_not_duplicate(self) -> None:
        """A genuinely different question passes."""
        accepted = ["When was the Treaty of Utrecht signed?"]
        assert not is_duplicate_question(
            "Which war did the Treaty of Utrecht end?", accepted
        )


class TestParseCritiques:
    """Critique reply parsing and the acceptance floor."""

    def test_parses_structured_output_scores_object(self) -> None:
        """The structured-outputs `scores` wrapper is the primary path."""
        raw = (
            '{"scores": [{"groundedness": 5, "standalone": 4, "realism": 4},'
            ' {"groundedness": 3, "standalone": 5, "realism": 5}]}'
        )
        scores = parse_critiques(raw, expected=2)
        assert scores is not None
        assert scores[0].standalone == 4
        assert scores[1].groundedness == 3

    def test_parses_scores_in_order(self) -> None:
        """Well-formed rows come back as typed scores."""
        raw = (
            '[{"groundedness": 5, "standalone": 4, "realism": 4},'
            ' {"groundedness": 2, "standalone": 5, "realism": 5}]'
        )
        scores = parse_critiques(raw, expected=2)
        assert scores is not None
        assert scores[0].passes(4)
        assert not scores[1].passes(4)

    def test_short_or_invalid_reply_is_none(self) -> None:
        """Missing rows, bad ranges, or non-numeric scores reject the reply."""
        assert parse_critiques('[{"groundedness": 5}]', expected=2) is None
        assert (
            parse_critiques(
                '[{"groundedness": 9, "standalone": 4, "realism": 4}]', expected=1
            )
            is None
        )
        assert (
            parse_critiques(
                '[{"groundedness": true, "standalone": 4, "realism": 4}]', expected=1
            )
            is None
        )

    def test_scores_serialize_for_metadata(self) -> None:
        """as_dict is the persistence shape for query metadata."""
        scores = CritiqueScores(groundedness=5, standalone=4, realism=4)
        assert scores.as_dict() == {"groundedness": 5, "standalone": 4, "realism": 4}
