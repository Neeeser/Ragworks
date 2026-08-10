"""Check each chunker's window against the embedding models it feeds.

The constraint belongs to the embedder — it is the model's input limit — but
the field a user changes to satisfy it is the chunker's, so findings are
addressed to the chunker while the message names the model imposing the limit.

Which embedders a chunker feeds, and what its chunks pick up on the way, come
from `app/pipelines/chunk_reach.py`. A chunker reaching an embedder *through*
another node says so, because a node in between may change chunk sizes and
the configured window then no longer describes what arrives.

Text a node on that path *adds* counts against the same limit, so it joins the
arithmetic: a contextual-retrieval node prepends its answer to every chunk,
and a window that fitted the model before it was wired in stops fitting
afterwards. Where such a node declares no budget for what it writes, the
arithmetic has no upper term at all — that node gets its own finding, on the
field that would fix it, rather than a comparison quietly made against a
number that is missing.

A node writing onto items the chunker never sized — a vision node accepting
images alone, describing the images the chunker forwarded — is checked
against the same limit but on its own terms: `chunk_size` cannot fix what it
writes, so its budget is compared with the limit directly and the finding is
addressed to its `max_output_tokens`.

Findings are advisory, never blocking. An oversized window still ingests — the
embedding guard splits the chunk and the file row carries a warning badge — so
refusing the save would strand work in progress over a condition the run
recovers from on its own.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from app.pipelines.chunk_reach import ChunkReach, TextGrowth, chunk_reach
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.nodes.chunking import FixedChunkerConfig
from app.pipelines.nodes.embedding import EmbedderConfig
from app.pipelines.registry import NodeRegistry
from app.providers.base import effective_embedding_input_limit

_TOKENIZER_LABELS = {
    "wordpiece": "BERT WordPiece",
    "cl100k": "cl100k",
    "huggingface": "HuggingFace tokenizer",
}


@dataclass(frozen=True)
class _EmbedderLimit:
    """One embedder's resolved effective input limit."""

    node_id: str
    model: str
    maximum: int


def _tokenizer_label(tokenizer: str) -> str:
    """Return the established human-readable counter label."""
    return _TOKENIZER_LABELS.get(tokenizer, tokenizer)


def _unknown_limit_issue(node_id: str, model: str) -> PipelineValidationIssue:
    """Return the documented saveable warning for unpublished model limits."""
    return PipelineValidationIssue(
        code="embedding_input_limit_unknown",
        message=(
            f"Embedding model '{model}' does not publish an input token limit; "
            "chunk-size compatibility could not be verified."
        ),
        severity="warning",
        node_id=node_id,
        model=model,
    )


def _unverifiable_growth_issue(
    growth: TextGrowth, limit: _EmbedderLimit
) -> PipelineValidationIssue:
    """Return the finding for a node writing an unbounded amount of text.

    Addressed to the node and to the field that fixes it: without a budget
    there is no upper term for the arithmetic, and comparing the chunker's
    window against the limit anyway would report as verified something that
    was never checked. A `replace` says so more strongly — it has discarded
    the chunk, so nothing about the window is knowable at all.
    """
    action = (
        "replaces each item's text with an unbounded amount"
        if growth.replaces
        else "writes an unbounded amount into each item's text"
    )
    return PipelineValidationIssue(
        code="embedding_input_limit_unverifiable",
        message=(
            f"Node '{growth.node_id}' {action}, because no maximum output tokens "
            f"is set, so the text reaching embedding model '{limit.model}' cannot "
            f"be checked against its {limit.maximum:,}-token input limit."
        ),
        severity="warning",
        node_id=growth.node_id,
        field="max_output_tokens",
        model=limit.model,
        allowed_max=limit.maximum,
    )


def _unchunked_issue(
    unchunked: tuple[TextGrowth, ...], limit: _EmbedderLimit
) -> PipelineValidationIssue | None:
    """Return the finding for writers filling an item past what the model takes.

    The items these nodes write onto were forwarded past the chunker rather
    than split by it, so their budgets are the only terms — accumulated the
    same way the chunker's window accumulates, because two vision nodes in
    series each fitting the limit can still leave an item that does not.
    A replace discards what came before and becomes the new base.

    Addressed to the largest contributor: with no chunker field in the
    arithmetic, the budget with the most leverage is the one to cut.
    """
    total = 0
    for growth in unchunked:
        if growth.unbudgeted:
            # The unverifiable finding is the whole answer for this path;
            # a comparison against a missing term would report as checked
            # something that never was.
            return None
        total = growth.written if growth.replaces else total + growth.written
    if not unchunked or total <= limit.maximum:
        return None
    largest = max(unchunked, key=lambda growth: (growth.written, growth.node_id))
    written = " and ".join(
        f"'{growth.node_id}' (up to {growth.written:,})" for growth in unchunked
    )
    return PipelineValidationIssue(
        code="embedding_input_limit_exceeded",
        message=(
            f"Text written onto each item by {written} totals {total:,} tokens, "
            f"exceeding embedding model '{limit.model}' effective input limit of "
            f"{limit.maximum:,}. These items reach the model without being chunked, "
            "so nothing but these budgets bounds them."
        ),
        severity="warning",
        node_id=largest.node_id,
        field="max_output_tokens",
        configured_value=total,
        model=limit.model,
        allowed_max=limit.maximum,
    )


@dataclass(frozen=True)
class _Window:
    """What arrives at the embedder, and whose field decides it."""

    tokens: int
    chunk_size: int
    chunk_overlap: int
    #: The last node on the path that replaced the text, if any. It took the
    #: chunker's place as the thing deciding the window, so it is what a
    #: finding must be addressed to.
    governor: TextGrowth | None
    #: Tokens written on top of the governing base (the replace, or the
    #: chunker's own window when nothing replaced).
    added_after: int
    #: A replace with no budget: the window has no computable value at all,
    #: and the unverifiable finding is the whole story.
    unknown: bool


def _resolve_window(chunk_size: int, chunk_overlap: int, reach: ChunkReach) -> _Window:
    """Compute what actually reaches the embedder.

    Overlap is added to chunk_size, so the emitted chunk is their sum. A node
    writing into that text rides on top of it; a node *replacing* it discards
    the chunk, so from there the chunker's size governs nothing and the
    node's own output becomes the base everything after it adds to.
    """
    tokens = chunk_size + chunk_overlap
    governor: TextGrowth | None = None
    added_after = 0
    unknown = False
    for growth in reach.growth:
        if not growth.replaces:
            tokens += growth.written
            added_after += growth.written
            continue
        if growth.unbudgeted:
            unknown = True
            break
        tokens = growth.written
        governor = growth
        added_after = 0
    return _Window(
        tokens=tokens,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        governor=governor,
        added_after=added_after,
        unknown=unknown,
    )


def _written_sentence(reach: ChunkReach) -> str:
    """Name the nodes writing extra text on top of whatever the base is.

    A node that *replaced* the text is not listed: the message already names
    it as the thing deciding the window, so repeating it as a contributor
    reads as a second, separate cost.
    """
    contributors = [growth for growth in reach.growth if growth.written and not growth.replaces]
    if not contributors:
        return ""
    written = ", ".join(
        f"'{growth.node_id}' (up to {growth.written:,})" for growth in contributors
    )
    return f" Text is written into each item on the way by {written}."


def _budget_caveat(reach: ChunkReach) -> str:
    """Note that a node's budget is counted by a different model's tokenizer."""
    if not any(growth.written for growth in reach.growth):
        return ""
    return " Node budgets count the writing model's output tokens, not the embedder's."


def _replaced_message(
    governor: TextGrowth, limit: _EmbedderLimit, reach: ChunkReach, window: _Window
) -> str:
    """State the window in terms of the node that took it over from the chunker."""
    extra = f", and {window.added_after:,} more is written after it" if window.added_after else ""
    return (
        f"Node '{governor.node_id}' replaces each item's text with up to "
        f"{governor.written:,} tokens{extra}, so what reaches embedding model "
        f"'{limit.model}' ({window.tokens:,}) exceeds its effective input limit "
        f"of {limit.maximum:,}.{_written_sentence(reach)}{_budget_caveat(reach)}"
    )


def _chunked_message(
    chunker: PipelineNodeDefinition,
    limit: _EmbedderLimit,
    reach: ChunkReach,
    window: _Window,
    tokenizer: str,
) -> str:
    """State the window in terms of the chunker, which still decides it."""
    if tokenizer == "whitespace":
        detail = "The whitespace counter undercounts model tokens."
    else:
        detail = f"The chunker uses {_tokenizer_label(tokenizer)} token counts."
    written = _written_sentence(reach)
    if not written and reach.hops > 1:
        detail += (
            f" Chunks reach '{limit.node_id}' through another node, which may change their size."
        )
    arithmetic = f"{window.chunk_size:,} + {window.chunk_overlap:,}"
    subject = "Chunk size plus overlap"
    if window.added_after:
        arithmetic += f" + {window.added_after:,}"
        subject = "Chunk size plus overlap plus text added downstream"
    return (
        f"{subject} ({arithmetic} = {window.tokens:,}) on node '{chunker.id}' exceeds "
        f"embedding model '{limit.model}' effective input limit of "
        f"{limit.maximum:,}. {detail}{written}{_budget_caveat(reach)}"
    )


def _chunk_limit_issue(
    chunker: PipelineNodeDefinition,
    limit: _EmbedderLimit,
    reach: ChunkReach,
) -> PipelineValidationIssue | None:
    """Build an advisory issue for a window the downstream model cannot take."""
    try:
        config = FixedChunkerConfig.model_validate(chunker.config or {})
    except ValidationError:
        return None
    chunk_size = getattr(config, "chunk_size", None)
    chunk_overlap = getattr(config, "chunk_overlap", None)
    if not isinstance(chunk_size, int) or not isinstance(chunk_overlap, int):
        return None
    window = _resolve_window(chunk_size, chunk_overlap, reach)
    if window.unknown or window.tokens <= limit.maximum:
        return None
    # Reported on the field that fixes it: once a node has replaced the text,
    # changing the chunker's size does nothing to what the model receives.
    governor = window.governor
    node_id = chunker.id if governor is None else governor.node_id
    field = "chunk_size" if governor is None else "max_output_tokens"
    message = (
        _chunked_message(chunker, limit, reach, window, config.tokenizer)
        if governor is None
        else _replaced_message(governor, limit, reach, window)
    )
    return PipelineValidationIssue(
        code="embedding_input_limit_exceeded",
        message=message,
        # Advisory, never blocking: an oversized window still ingests — the
        # embedding guard splits the chunk and the file row carries a warning
        # badge — so refusing the save would strand work in progress over a
        # condition the run itself recovers from.
        severity="warning",
        node_id=node_id,
        field=field,
        configured_value=window.tokens,
        model=limit.model,
        allowed_max=limit.maximum,
    )


def embedding_limit_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    resolve_limit: object,
) -> list[PipelineValidationIssue]:
    """Return findings comparing chunk windows with downstream model limits."""
    if not callable(resolve_limit):
        return []
    node_map = definition.node_map()
    reach = chunk_reach(definition, registry)
    limits: dict[str, _EmbedderLimit] = {}
    issues: list[PipelineValidationIssue] = []
    reachable = {embedder for targets in reach.values() for embedder in targets}
    for embedder_id in sorted(reachable):
        config = EmbedderConfig.model_validate(node_map[embedder_id].config or {})
        if config.connection_id is None or not config.model_name:
            # The embedder already reports its own missing-model error; a
            # second finding here would be noise on an invalid pipeline.
            continue
        published = resolve_limit(config.connection_id, config.model_name)
        if published is None:
            issues.append(_unknown_limit_issue(embedder_id, config.model_name))
            continue
        limits[embedder_id] = _EmbedderLimit(
            node_id=embedder_id,
            model=config.model_name,
            maximum=effective_embedding_input_limit(published),
        )

    # Keyed by node id: a writer sitting on several chunkers' paths would
    # otherwise be reported once per chunker, on the one field it has.
    per_writer: dict[str, PipelineValidationIssue] = {}
    for chunker_id, targets in reach.items():
        known = [(limits[node_id], entry) for node_id, entry in targets.items() if node_id in limits]
        if not known:
            continue
        # A chunk must fit every embedder it flows into, so the smallest limit
        # is the binding one. One issue per chunker, not one per pair: the
        # editor renders a single issue per field, so several would hide each
        # other — possibly leaving the least restrictive one showing.
        ordered = sorted(known, key=lambda entry: (entry[0].maximum, entry[0].node_id))
        limit, binding = ordered[0]
        issue = _chunk_limit_issue(node_map[chunker_id], limit, binding)
        if issue is not None:
            issues.append(issue)
        # Writers are checked against every embedder they reach, not only the
        # one binding the chunker's window: a writer on a branch feeding a
        # different model is absent from the binding path entirely, and
        # checking that path alone drops its finding. Strictest limit first,
        # so the dedupe below keeps the binding one.
        for entry_limit, entry in ordered:
            _collect_writer_issues(entry, entry_limit, per_writer)
    issues.extend(per_writer.values())
    return issues


def _collect_writer_issues(
    reach: ChunkReach,
    limit: _EmbedderLimit,
    into: dict[str, PipelineValidationIssue],
) -> None:
    """Record findings addressed to the nodes writing text on this path.

    A node writing onto the chunks is only reported here when it declares
    no budget — otherwise its cost is already in the chunker's arithmetic.
    Nodes writing onto items the chunker never sized are reported on their
    own, since no chunker field accounts for them.
    """
    for growth in (*reach.growth, *reach.unchunked):
        if growth.unbudgeted and growth.node_id not in into:
            into[growth.node_id] = _unverifiable_growth_issue(growth, limit)
    issue = _unchunked_issue(reach.unchunked, limit)
    if issue is not None and issue.node_id is not None and issue.node_id not in into:
        into[issue.node_id] = issue
