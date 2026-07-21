"""Corpus reconstruction from stored chunks: overlap stripping and joining."""

from __future__ import annotations

from app.evals.generation.corpus import join_chunks, split_overlap


class TestSplitOverlap:
    """The suffix/prefix overlap detector."""

    def test_strips_verbatim_overlap(self) -> None:
        """A chunk repeating the previous chunk's tail loses that prefix."""
        piece, seamless = split_overlap(
            "The quick brown fox jumps over", " jumps over the lazy dog"
        )
        assert piece == " the lazy dog"
        assert seamless is True

    def test_no_overlap_returns_chunk_unchanged(self) -> None:
        """Disjoint chunks pass through untouched and report no overlap."""
        piece, seamless = split_overlap("first section text", "second section text")
        assert piece == "second section text"
        assert seamless is False

    def test_tiny_coincidental_match_is_not_overlap(self) -> None:
        """A shared short token (below the minimum) is coincidence, not overlap."""
        piece, seamless = split_overlap("ends with the", "the start of next")
        assert piece == "the start of next"
        assert seamless is False

    def test_fully_contained_chunk_strips_to_empty(self) -> None:
        """A chunk that is entirely the previous chunk's tail strips to nothing."""
        piece, seamless = split_overlap("alpha beta gamma delta", " gamma delta")
        assert piece == ""
        assert seamless is True


class TestJoinChunks:
    """Whole-document reconstruction."""

    def test_overlapping_windows_reconstruct_original_text(self) -> None:
        """A token-window split with overlap joins back to the exact source."""
        original = "one two three four five six seven eight nine ten eleven twelve"
        words = original.split()
        chunks = [
            " ".join(words[0:6]),
            " ".join(words[4:10]),
            " ".join(words[8:12]),
        ]
        assert join_chunks(chunks) == original

    def test_disjoint_chunks_join_with_paragraph_break(self) -> None:
        """Without a detectable overlap the gap becomes a paragraph break."""
        assert join_chunks(["first paragraph here", "second paragraph there"]) == (
            "first paragraph here\n\nsecond paragraph there"
        )

    def test_empty_input_yields_empty_text(self) -> None:
        """No chunks, no text."""
        assert join_chunks([]) == ""
