"""Candidate parsing and mechanical filtering for synthetic generation.

Everything here is pure and tolerant by design: the generator may be a small
local model, so a malformed reply discards the candidate (or the reply), never
the job. The two mechanical gates — the verbatim-quote match and question
dedup — run before any critique call, because they are free and catch most
ungrounded or repeated output.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher

QUOTE_MATCH_THRESHOLD = 0.85
DUPLICATE_THRESHOLD = 0.85

_CODE_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_WHITESPACE = re.compile(r"\s+")
_WORD = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True)
class CandidateQuestion:
    """One generated question with its claimed supporting quote."""

    question: str
    answer: str
    quote: str


@dataclass(frozen=True)
class CritiqueScores:
    """One candidate's critique verdict on the three quality criteria."""

    groundedness: int
    standalone: int
    realism: int

    def passes(self, minimum: int) -> bool:
        """True when every criterion meets the acceptance floor."""
        return min(self.groundedness, self.standalone, self.realism) >= minimum

    def as_dict(self) -> dict[str, int]:
        """Plain dict for JSON persistence in query metadata."""
        return {
            "groundedness": self.groundedness,
            "standalone": self.standalone,
            "realism": self.realism,
        }


def extract_json_array(raw: str) -> list[object] | None:
    """Pull the first JSON array out of an LLM reply, fences and prose tolerated."""
    fenced = _CODE_FENCE.search(raw)
    body = fenced.group(1) if fenced else raw
    start = body.find("[")
    if start < 0:
        return None
    decoder = json.JSONDecoder()
    try:
        value, _ = decoder.raw_decode(body[start:])
    except ValueError:
        return None
    return value if isinstance(value, list) else None


def parse_candidates(raw: str) -> list[CandidateQuestion]:
    """Parse a generation reply into candidates, dropping malformed items."""
    items = extract_json_array(raw)
    if items is None:
        return []
    candidates: list[CandidateQuestion] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        question = _clean_str(item.get("question"))
        quote = _clean_str(item.get("quote"))
        answer = _clean_str(item.get("answer"))
        if question and quote:
            candidates.append(
                CandidateQuestion(question=question, answer=answer, quote=quote)
            )
    return candidates


def parse_critiques(raw: str, expected: int) -> list[CritiqueScores] | None:
    """Parse a critique reply; None when it does not cover every candidate."""
    items = extract_json_array(raw)
    if items is None or len(items) < expected:
        return None
    scores: list[CritiqueScores] = []
    for item in items[:expected]:
        if not isinstance(item, dict):
            return None
        parsed = _parse_score_row(item)
        if parsed is None:
            return None
        scores.append(parsed)
    return scores


def quote_matches(
    quote: str, context: str, threshold: float = QUOTE_MATCH_THRESHOLD
) -> bool:
    """True when the quote appears (near-)verbatim in the context.

    Whitespace and case are normalized first; then either the quote is a
    substring, or its in-order matching blocks against the context cover at
    least `threshold` of it. Summing blocks (rather than requiring one
    contiguous block) tolerates a small mid-quote transcription slip without
    letting invented quotes through — scattered stopword matches cannot reach
    the threshold.
    """
    needle = normalize_text(quote)
    haystack = normalize_text(context)
    if not needle or not haystack:
        return False
    if needle in haystack:
        return True
    matcher = SequenceMatcher(None, needle, haystack, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    return matched / len(needle) >= threshold


def is_duplicate_question(
    question: str,
    accepted: list[str],
    threshold: float = DUPLICATE_THRESHOLD,
) -> bool:
    """True when the question near-repeats one already accepted.

    Similarity is the max of character-level ratio and token-set Jaccard, so
    both light rephrasings and word-order shuffles register.
    """
    normalized = normalize_text(question)
    tokens = set(_WORD.findall(normalized))
    for other in accepted:
        other_normalized = normalize_text(other)
        if SequenceMatcher(None, normalized, other_normalized).ratio() >= threshold:
            return True
        other_tokens = set(_WORD.findall(other_normalized))
        union = tokens | other_tokens
        if union and len(tokens & other_tokens) / len(union) >= threshold:
            return True
    return False


def normalize_text(value: str) -> str:
    """Lowercase and collapse whitespace for comparison purposes."""
    return _WHITESPACE.sub(" ", value.lower()).strip()


def _clean_str(value: object) -> str:
    """A stripped string when the value is one, otherwise empty."""
    return value.strip() if isinstance(value, str) else ""


def _parse_score_row(item: dict[object, object]) -> CritiqueScores | None:
    """Read the three 1-5 criterion scores from one critique row."""
    values: dict[str, int] = {}
    for key in ("groundedness", "standalone", "realism"):
        raw = item.get(key)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return None
        score = int(raw)
        if not 1 <= score <= 5:
            return None
        values[key] = score
    return CritiqueScores(**values)
