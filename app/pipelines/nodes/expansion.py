"""Context-expansion nodes: widen a retrieval match into the text around it.

Retrieval scores small chunks because small chunks embed precisely, but a
small chunk is often too narrow to answer from — the sentence that matched
sits in a paragraph whose surrounding sentences carry the actual answer.
Expand Context re-reads the stored chunk lineage and replaces each match
with the text around it: its neighbouring chunks (window mode) or its whole
source document (parent mode).

Both modes read the same primitive, `VectorStoreBackend.fetch_document_chunks`
— a document's chunks in the order the chunker emitted them. The window is
computed over that stored order rather than over ids, so a document's first
and last chunks expand to whatever actually exists instead of running off
the end.

Matches landing in the same span merge: two neighbouring chunks of one
document both matching would otherwise expand into two heavily overlapping
items that spend the answer's context budget on the same text twice. The
merged item keeps the best contributing score and that match's provenance,
and sits at the position where the earliest of its contributors ranked, so
the ranking arriving from the retriever survives expansion.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.validators import missing_index_issue
from app.pipelines.payloads import Item, ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.template import namespace_field, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import summarize_match_order, summarize_matches
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.retrieval.models import DocumentChunk
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError
from app.services.namespace_ownership import resolve_owned_namespace

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry

#: Upper bound on the chunks one document's lineage read returns. A parent
#: expansion of a book-length document would otherwise pull every chunk it
#: has into one item and into the answer's context window; past this size
#: the pipeline wants a window, not a parent.
MAX_DOCUMENT_CHUNKS = 500

#: Upper bound on the distinct documents one run expands. Each is one store
#: round trip, so an unbounded result stream wired in (a whole corpus scan)
#: would issue hundreds of sequential reads.
MAX_EXPANDED_DOCUMENTS = 64


class ExpandContextConfig(BaseModel):
    """Configuration for the context-expansion node."""

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend),
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    index_name: str = Field(
        default="",
        json_schema_extra=STATIC_ONLY_EXTRA,
        description=(
            "The index holding the chunks to expand from — normally the same "
            "index the retriever feeding this node queried."
        ),
    )
    namespace: str = namespace_field()
    mode: Literal["window", "parent"] = Field(
        default="window",
        description=(
            "window: replace each match with itself plus the neighbouring "
            "chunks either side of it. parent: replace each match with its "
            "whole source document."
        ),
    )
    window: int = Field(
        default=1,
        ge=0,
        description=(
            "How many chunks either side of a match to include, in window "
            "mode. 1 expands a match to three chunks. 0 expands to the match "
            "alone, which merges duplicates but adds no surrounding text. "
            "Ignored in parent mode."
        ),
    )
    separator: str = Field(
        default="\n\n",
        description="Joined between the chunk texts of one expanded item.",
    )


class _Span(BaseModel):
    """One contiguous run of a document's chunks, and the matches behind it."""

    document_id: str
    start: int
    end: int
    #: Rank of the earliest-arriving contributing match, so merged spans keep
    #: the position the input stream gave them.
    rank: int
    best: Item

    def overlaps(self, other: _Span) -> bool:
        """True when the two spans share at least one chunk, so they merge.

        Strict intersection, not adjacency: merging is for spans that would
        repeat the same chunks in two items. Two abutting spans repeat
        nothing, so keeping them apart preserves both matches' scores for the
        ranking stage at no cost to the answer's context budget.
        """
        return self.start <= other.end and other.start <= self.end


class ExpandContextNode(PipelineNodeBase[ExpandContextConfig]):
    """Replace each retrieval match with the stored text surrounding it."""

    type = "expand.context"
    label = "Expand Context"
    category = "retrieval"
    description = (
        "Widen each result to the text around it, read back from the index. "
        "Retrieval scores small chunks because small chunks embed precisely, "
        "but the matched chunk alone is often too narrow to answer from. "
        "Window mode adds the neighbouring chunks either side of each match; "
        "parent mode replaces the match with its whole source document. "
        "Matches falling in the same span merge into one item keeping the "
        "best score, so overlapping windows do not spend the answer's context "
        "budget on the same text twice — the output is never longer than the "
        "input. Scores and document provenance are preserved; the item's "
        "embedding is not, because it described the matched chunk alone."
    )
    example = (
        "Items(doc:2 scored 0.8), window=1 -> Items(doc:1 + doc:2 + doc:3, 0.8); "
        "Items(doc:1, doc:2), window=1 -> one merged item spanning doc:0..doc:3."
    )
    # Unrestricted: expansion is positional, not modal. What an item *is*
    # does not decide whether it has neighbours — an indexed image chunk sits
    # in the document's ordering exactly like a text chunk, and expanding it
    # is how the page around a matched figure reaches the answer.
    input_ports = (NodePort(key="items", label="Results", data_type=PortKind.ITEMS),)
    output_ports = (
        NodePort(
            key="items",
            label="Expanded Results",
            data_type=PortKind.ITEMS,
            preserves=True,
            adds=(Facet.TEXT,),
            # The vector described the matched chunk alone; the item now
            # carries the text around it, so an indexer must not be handed a
            # vector for content that is no longer what it would store. The
            # score is deliberately kept: it is the retrieval relevance of the
            # match this item stands for, and the ranking stage downstream
            # (Score Threshold, Result Limit) is what consumes it.
            removes=(Facet.EMBEDDING,),
        ),
    )
    config_model = ExpandContextConfig

    def __init__(self, config: ExpandContextConfig) -> None:
        """Track expansion counts so the trace can report matches in vs out."""
        super().__init__(config)
        self._documents_read = 0

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Require an index to expand from — there is no lineage without one."""
        config = cls.config_model.model_validate(node.config or {})
        issue = missing_index_issue(config.index_name, node, "Expand Context")
        return [issue] if issue else []

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Expand every match into its surrounding span, merging overlaps."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        self._documents_read = 0
        if not batch.items:
            # No matches means no lineage to read: never touch the store.
            return {"items": batch}

        lineage = self._read_lineage(batch.items, context)
        spans = self._merge(self._spans(batch.items, lineage))
        expanded = [self._expand(span, lineage[span.document_id]) for span in spans]
        return {"items": batch.model_copy(update={"items": expanded})}

    def _read_lineage(
        self, items: list[Item], context: PipelineRunContext
    ) -> dict[str, list[DocumentChunk]]:
        """Read each matched document's stored chunks once, in chunk order."""
        namespace = resolve_owned_namespace(
            self.config.namespace, context.collection, context.session
        )
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )
        store = context.vector_stores.get(self.config.backend)

        document_ids: list[str] = []
        for item in items:
            document_id = self._require_lineage(item)
            if document_id not in document_ids:
                document_ids.append(document_id)
        if len(document_ids) > MAX_EXPANDED_DOCUMENTS:
            raise InvalidInputError(
                f"Expand Context received matches from {len(document_ids)} documents; "
                f"at most {MAX_EXPANDED_DOCUMENTS} are expanded per run. Cut the "
                "stream feeding it (e.g. with a Result Limit node)."
            )

        lineage: dict[str, list[DocumentChunk]] = {}
        for document_id in document_ids:
            chunks = store.fetch_document_chunks(
                index_name, namespace or "", document_id, limit=MAX_DOCUMENT_CHUNKS
            )
            if not chunks:
                raise InvalidInputError(
                    f"Expand Context found no stored chunks for document "
                    f"'{document_id}' in index '{index_name}'. Point the node at "
                    "the index and namespace the retriever feeding it queried."
                )
            if len(chunks) > 1 and len({chunk.order for chunk in chunks}) == 1:
                # A store row missing its `order` reads back as 0, so a whole
                # document sharing one order carries no ordering at all — every
                # window would cover all of it and quietly behave like parent
                # mode. Refuse rather than answer with a window nobody chose.
                raise InvalidInputError(
                    f"Expand Context read {len(chunks)} chunks for document "
                    f"'{document_id}' that all share chunk order "
                    f"{chunks[0].order}. The stored chunks carry no ordering to "
                    "expand along; re-ingest the document."
                )
            lineage[document_id] = chunks
        self._documents_read = len(lineage)
        return lineage

    @staticmethod
    def _require_lineage(item: Item) -> str:
        """Return the item's document id, refusing an item with no lineage.

        An item carrying no document or no chunk order cannot be located in
        the stored ordering at all, so there is nothing to expand around it.
        Passing it through unchanged would make a misconfigured graph look
        like one where expansion simply found nothing.
        """
        if item.document_id is None or item.order is None:
            raise InvalidInputError(
                f"Expand Context received item '{item.id}' without a document id "
                "and chunk order. It expands retrieval matches read from an "
                "index; wire it downstream of a retriever."
            )
        return item.document_id

    def _spans(self, items: list[Item], lineage: dict[str, list[DocumentChunk]]) -> list[_Span]:
        """Turn each match into the span of chunk orders it expands to."""
        spans: list[_Span] = []
        for rank, item in enumerate(items):
            document_id = self._require_lineage(item)
            orders = [chunk.order for chunk in lineage[document_id]]
            if self.config.mode == "parent":
                start, end = min(orders), max(orders)
            else:
                # `item.order` is not None: `_require_lineage` refused it above.
                anchor = item.order if item.order is not None else 0
                start = anchor - self.config.window
                end = anchor + self.config.window
            spans.append(_Span(document_id=document_id, start=start, end=end, rank=rank, best=item))
        return spans

    @staticmethod
    def _merge(spans: list[_Span]) -> list[_Span]:
        """Merge overlapping spans of one document into one, keeping the best score.

        Spans are swept in `(document, start)` order rather than in arrival
        order, because a span can bridge two others that do not overlap each
        other: matches at chunks 2, 8, and 5 with a ±2 window produce [0,4],
        [6,10], and [3,7], and folding the third into whichever it met first
        would leave two items both holding chunks 6 and 7. Sorted, every merge
        only ever extends the current run rightward, so one pass is enough and
        no span can be left straddling two emitted items.

        The output is then ordered by the earliest contributing match, so the
        ranking the retrieval stage produced survives expansion.
        """
        merged: list[_Span] = []
        for span in sorted(spans, key=lambda span: (span.document_id, span.start)):
            current = merged[-1] if merged else None
            if (
                current is None
                or current.document_id != span.document_id
                or not current.overlaps(span)
            ):
                merged.append(span)
                continue
            # Strictly greater, so a tie keeps the match the merged span starts
            # at — deterministic regardless of the order the matches arrived in.
            best = span.best if _rank_score(span.best) > _rank_score(current.best) else current.best
            merged[-1] = current.model_copy(
                update={
                    "end": max(current.end, span.end),
                    "rank": min(current.rank, span.rank),
                    "best": best,
                }
            )
        return sorted(merged, key=lambda span: span.rank)

    def _expand(self, span: _Span, chunks: list[DocumentChunk]) -> Item:
        """Build one item carrying the span's joined text.

        Identity, score, and metadata come from the span's best-scoring
        match, so provenance (path, filename) and the score the ranking stage
        reads both describe a real retrieved chunk rather than a synthesized
        one.

        A span the lineage read did not cover keeps the match's own text: a
        document longer than `MAX_DOCUMENT_CHUNKS` is truncated at that many
        chunks, so a match past the cut would otherwise expand to the empty
        string and lose the very chunk retrieval found.
        """
        covered = [chunk.text for chunk in chunks if span.start <= chunk.order <= span.end]
        if not covered:
            return span.best.model_copy(update={"embedding": None})
        return span.best.model_copy(
            update={"text": self.config.separator.join(covered), "embedding": None}
        )

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the matches that arrived against the expanded items."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Matches", value=summarize_matches(input_batch.preview_matches())
                ),
                NodeTraceValue(
                    label="Match order",
                    value=summarize_match_order(input_batch.preview_matches()),
                ),
                NodeTraceValue(
                    label="Match items", value=trace_items(input_batch.items), kind="items"
                ),
            ],
            outputs=[
                NodeTraceValue(
                    label="Expansion",
                    value={
                        "mode": self.config.mode,
                        "window": self.config.window if self.config.mode == "window" else None,
                        "matches_in": len(input_batch.items),
                        "expanded_out": len(output_batch.items),
                        "merged": len(input_batch.items) - len(output_batch.items),
                        "documents_read": self._documents_read,
                    },
                ),
                NodeTraceValue(
                    label="Expanded items",
                    value=trace_items(output_batch.items),
                    kind="items",
                ),
            ],
        )


def _rank_score(item: Item) -> float:
    """Score for ranking purposes; an unscored item sorts below every scored one."""
    return item.score if item.score is not None else float("-inf")
