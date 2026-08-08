"""Behavior of the Expand Context node.

What matters is which stored chunks reach each expanded item, that a window
at a document's edge expands to what exists rather than running off the end,
that matches sharing a span merge into one item keeping the best score and
the input's ranking, and that an item with no lineage to expand around
fails honestly instead of passing through looking expanded.
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.expansion import (
    MAX_DOCUMENT_CHUNKS,
    MAX_EXPANDED_DOCUMENTS,
    ExpandContextConfig,
    ExpandContextNode,
)
from app.pipelines.payloads import Item, ItemBatch
from app.pipelines.ports import Facet
from app.pipelines.registry import build_default_registry
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.services.errors import InvalidInputError
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
)


def _chunk(document_id: str, order: int, text: str | None = None) -> DocumentChunk:
    return DocumentChunk(
        document_id=document_id,
        chunk_id=f"{document_id}:{order}",
        text=text if text is not None else f"chunk-{order}",
        order=order,
        metadata=DocumentMetadata(data={"filename": f"{document_id}.txt"}),
    )


def _match(document_id: str, order: int, score: float | None = 0.5) -> Item:
    return Item(
        id=f"{document_id}:{order}",
        text=f"chunk-{order}",
        score=score,
        document_id=document_id,
        order=order,
        metadata=DocumentMetadata(data={"filename": f"{document_id}.txt"}),
    )


def _store(lineage: dict[str, list[DocumentChunk]]) -> StubVectorStore:
    store = StubVectorStore()
    store.document_chunks = lineage
    return store


def _context(session: Session, store: StubVectorStore) -> PipelineRunContext:
    user = models.User(id=uuid4(), email="expand@test.local", hashed_password="hashed")
    collection = models.Collection(
        id=uuid4(), user_id=user.id, name="Expand", description="", extra_metadata={}
    )
    return PipelineRunContext(
        session=session,
        user=user,
        collection=collection,
        document=None,
        query="hello",
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(store),
        storage=FileStorage(base_path=Path("/tmp/expand-context-tests")),
        settings=get_settings(),
    )


def _config(**overrides: object) -> ExpandContextConfig:
    return ExpandContextConfig.model_validate({"index_name": "corpus", **overrides})


def _items(outputs: dict[str, object]) -> list[Item]:
    return ItemBatch.model_validate(outputs["items"]).items


#: A five-chunk document, the fixture every window case is measured against.
DOC = [_chunk("doc", order) for order in range(5)]


class TestWindowMode:
    """Each match becomes itself plus N chunks either side, bounded by the document."""

    def test_expands_a_middle_match_to_both_neighbours(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[_match("doc", 2)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == ["chunk-1\n\nchunk-2\n\nchunk-3"]

    def test_a_window_at_the_first_chunk_stops_at_the_document_start(
        self, session: Session
    ) -> None:
        """Chunk 0 has no predecessor: the window covers what exists, not a gap."""
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=2)).run(
            {"items": ItemBatch(items=[_match("doc", 0)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == ["chunk-0\n\nchunk-1\n\nchunk-2"]

    def test_a_window_at_the_last_chunk_stops_at_the_document_end(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=2)).run(
            {"items": ItemBatch(items=[_match("doc", 4)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == ["chunk-2\n\nchunk-3\n\nchunk-4"]

    def test_a_window_wider_than_the_document_yields_the_whole_document(
        self, session: Session
    ) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=99)).run(
            {"items": ItemBatch(items=[_match("doc", 2)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == [
            "chunk-0\n\nchunk-1\n\nchunk-2\n\nchunk-3\n\nchunk-4"
        ]

    def test_a_zero_window_leaves_the_matched_chunk_alone(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=0)).run(
            {"items": ItemBatch(items=[_match("doc", 2)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == ["chunk-2"]

    def test_the_separator_is_configurable(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=1, separator=" | ")).run(
            {"items": ItemBatch(items=[_match("doc", 1)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == ["chunk-0 | chunk-1 | chunk-2"]


class TestOverlapMerging:
    """Matches sharing a span become one item, keeping the best score and ranking."""

    def test_overlapping_windows_merge_into_one_item(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[_match("doc", 1, 0.9), _match("doc", 2, 0.4)])},
            _context(session, store),
        )
        items = _items(outputs)
        assert len(items) == 1
        assert items[0].text == "chunk-0\n\nchunk-1\n\nchunk-2\n\nchunk-3"

    def test_a_merged_item_keeps_the_best_contributing_score_and_provenance(
        self, session: Session
    ) -> None:
        """The weaker match arrives first; the merged item still scores 0.9."""
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[_match("doc", 1, 0.4), _match("doc", 2, 0.9)])},
            _context(session, store),
        )
        (item,) = _items(outputs)
        assert item.score == 0.9
        assert item.id == "doc:2"
        assert item.metadata.data["filename"] == "doc.txt"

    def test_abutting_windows_stay_separate_and_duplicate_no_text(self, session: Session) -> None:
        """Windows [0,2] and [3,5] touch but do not intersect.

        Merging is for spans that would repeat the same chunks; these repeat
        nothing, so keeping them apart preserves both matches' scores for the
        ranking stage without costing the answer any duplicated text.
        """
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[_match("doc", 1, 0.9), _match("doc", 4, 0.6)])},
            _context(session, store),
        )
        items = _items(outputs)
        assert [item.text for item in items] == [
            "chunk-0\n\nchunk-1\n\nchunk-2",
            "chunk-3\n\nchunk-4",
        ]
        assert [item.score for item in items] == [0.9, 0.6]

    def test_non_overlapping_windows_stay_separate(self, session: Session) -> None:
        store = _store({"doc": [_chunk("doc", order) for order in range(9)]})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[_match("doc", 1), _match("doc", 7)])},
            _context(session, store),
        )
        assert [item.id for item in _items(outputs)] == ["doc:1", "doc:7"]

    def test_a_span_bridging_two_others_merges_all_three(self, session: Session) -> None:
        """A late match can join two spans that did not overlap each other.

        Windows [0,4] and [6,10] are disjoint, so they are kept apart. A third
        match at chunk 5 spans [3,7], which overlaps both: merging it into only
        the first leaves [0,7] and [6,10] both holding chunks 6 and 7, so the
        answer pays for that text twice. Reachable whenever matches arrive
        score-ordered rather than document-ordered.
        """
        store = _store({"doc": [_chunk("doc", order) for order in range(11)]})
        outputs = ExpandContextNode(_config(window=2)).run(
            {
                "items": ItemBatch(
                    items=[_match("doc", 2, 0.9), _match("doc", 8, 0.8), _match("doc", 5, 0.7)]
                )
            },
            _context(session, store),
        )
        items = _items(outputs)
        assert len(items) == 1
        assert items[0].text == "\n\n".join(f"chunk-{order}" for order in range(11))

    def test_matches_in_different_documents_never_merge(self, session: Session) -> None:
        """Same chunk orders, different documents: two items, not one."""
        store = _store({"a": [_chunk("a", 0)], "b": [_chunk("b", 0)]})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[_match("a", 0), _match("b", 0)])},
            _context(session, store),
        )
        assert [item.id for item in _items(outputs)] == ["a:0", "b:0"]

    def test_the_output_keeps_the_input_ranking(self, session: Session) -> None:
        """A merged span sits where its earliest contributor ranked."""
        store = _store({"a": [_chunk("a", order) for order in range(3)], "b": [_chunk("b", 0)]})
        outputs = ExpandContextNode(_config(window=1)).run(
            {
                "items": ItemBatch(
                    items=[_match("a", 0, 0.9), _match("b", 0, 0.8), _match("a", 1, 0.95)]
                )
            },
            _context(session, store),
        )
        # a:0 and a:1 merge at rank 0 (a:1 wins the score), b:0 stays second.
        assert [item.id for item in _items(outputs)] == ["a:1", "b:0"]


class TestParentMode:
    """Each match is replaced by the whole source document."""

    def test_replaces_a_match_with_the_whole_document(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(mode="parent")).run(
            {"items": ItemBatch(items=[_match("doc", 3)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == [
            "chunk-0\n\nchunk-1\n\nchunk-2\n\nchunk-3\n\nchunk-4"
        ]

    def test_several_matches_in_one_document_collapse_to_one_parent(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(mode="parent")).run(
            {"items": ItemBatch(items=[_match("doc", 0, 0.3), _match("doc", 4, 0.7)])},
            _context(session, store),
        )
        items = _items(outputs)
        assert len(items) == 1
        assert items[0].score == 0.7

    def test_parent_mode_ignores_the_window_setting(self, session: Session) -> None:
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(mode="parent", window=0)).run(
            {"items": ItemBatch(items=[_match("doc", 2)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == [
            "chunk-0\n\nchunk-1\n\nchunk-2\n\nchunk-3\n\nchunk-4"
        ]

    def test_one_store_read_per_document_however_many_matches(self, session: Session) -> None:
        store = _store({"doc": DOC})
        ExpandContextNode(_config(mode="parent")).run(
            {"items": ItemBatch(items=[_match("doc", n) for n in range(5)])},
            _context(session, store),
        )
        assert len(store.fetch_document_calls) == 1


class TestEmptyInput:
    """An empty result stream expands to nothing and never touches the store."""

    def test_empty_input_returns_empty_output(self, session: Session) -> None:
        store = _store({})
        outputs = ExpandContextNode(_config()).run(
            {"items": ItemBatch(items=[])}, _context(session, store)
        )
        assert _items(outputs) == []

    def test_empty_input_issues_no_store_read(self, session: Session) -> None:
        store = _store({})
        ExpandContextNode(_config()).run({"items": ItemBatch(items=[])}, _context(session, store))
        assert store.fetch_document_calls == []


class TestMissingLineage:
    """An item that cannot be located in a stored ordering fails honestly."""

    def test_an_item_without_a_document_id_is_refused(self, session: Session) -> None:
        store = _store({"doc": DOC})
        orphan = Item(id="loose", text="loose", score=0.5, order=0)
        with pytest.raises(InvalidInputError, match="without a document id"):
            ExpandContextNode(_config()).run(
                {"items": ItemBatch(items=[orphan])}, _context(session, store)
            )

    def test_an_item_without_a_chunk_order_is_refused(self, session: Session) -> None:
        store = _store({"doc": DOC})
        orphan = Item(id="doc:0", text="x", score=0.5, document_id="doc")
        with pytest.raises(InvalidInputError, match="without a document id"):
            ExpandContextNode(_config()).run(
                {"items": ItemBatch(items=[orphan])}, _context(session, store)
            )

    def test_a_document_the_index_does_not_hold_is_refused(self, session: Session) -> None:
        """Pointing the node at the wrong index must not look like an empty document."""
        store = _store({})
        with pytest.raises(InvalidInputError, match="no stored chunks for document"):
            ExpandContextNode(_config()).run(
                {"items": ItemBatch(items=[_match("doc", 0)])}, _context(session, store)
            )

    def test_a_document_whose_chunks_share_one_order_is_refused(
        self, session: Session
    ) -> None:
        """Rows missing their stored order read back as 0, which is no ordering.

        Every window would then cover the whole document and quietly behave
        like parent mode, so the run is refused instead.
        """
        flat = [_chunk("doc", 0), _chunk("doc", 0), _chunk("doc", 0)]
        store = _store({"doc": flat})
        with pytest.raises(InvalidInputError, match="share chunk order"):
            ExpandContextNode(_config()).run(
                {"items": ItemBatch(items=[_match("doc", 0)])}, _context(session, store)
            )

    def test_a_single_chunk_document_is_not_mistaken_for_lost_ordering(
        self, session: Session
    ) -> None:
        """One chunk trivially shares its own order; that is an ordinary document."""
        store = _store({"doc": [_chunk("doc", 0)]})
        outputs = ExpandContextNode(_config(window=2)).run(
            {"items": ItemBatch(items=[_match("doc", 0)])}, _context(session, store)
        )
        assert [item.text for item in _items(outputs)] == ["chunk-0"]

    def test_a_match_beyond_the_chunk_cap_keeps_its_own_text(
        self, session: Session
    ) -> None:
        """A truncated lineage must not expand a real match into an empty string."""
        store = _store({"doc": [_chunk("doc", order) for order in range(3)]})
        # The match sits far past everything the lineage read returned.
        beyond = _match("doc", 900, 0.6)
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[beyond])}, _context(session, store)
        )
        (item,) = _items(outputs)
        assert item.text == "chunk-900"
        assert item.score == 0.6

    def test_more_documents_than_the_fanout_cap_is_refused(self, session: Session) -> None:
        count = MAX_EXPANDED_DOCUMENTS + 1
        store = _store({f"doc{n}": [_chunk(f"doc{n}", 0)] for n in range(count)})
        batch = ItemBatch(items=[_match(f"doc{n}", 0) for n in range(count)])
        with pytest.raises(InvalidInputError, match="at most"):
            ExpandContextNode(_config()).run({"items": batch}, _context(session, store))


class TestValidation:
    """The editor's save gate: there is no lineage to read without an index."""

    def _issues(self, config: dict[str, object]) -> list[str]:
        node = PipelineNodeDefinition(
            id="expand", name="Expand Context", type=ExpandContextNode.type, config=config
        )
        definition = PipelineDefinition(nodes=[node], edges=[])
        issues = ExpandContextNode.validation_issues_for_node(
            node, definition, build_default_registry()
        )
        # Every finding must name the node, or the editor cannot point at it.
        assert all(issue.node_id == "expand" for issue in issues)
        return [issue.message for issue in issues]

    def test_a_blank_index_is_flagged(self) -> None:
        assert self._issues({"index_name": ""})

    def test_a_named_index_validates_cleanly(self) -> None:
        assert self._issues({"index_name": "corpus"}) == []


class TestFacetsAndTrace:
    """The expanded item's declared facets and the trace's expansion counts."""

    def test_the_expanded_item_drops_its_embedding(self, session: Session) -> None:
        """The vector described the matched chunk, not the span now in `text`."""
        store = _store({"doc": DOC})
        match = _match("doc", 2).model_copy(update={"embedding": [0.1, 0.2]})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[match])}, _context(session, store)
        )
        (item,) = _items(outputs)
        assert item.embedding is None
        assert Facet.EMBEDDING not in item.facets()

    def test_the_output_port_declares_the_embedding_it_removes(self) -> None:
        (port,) = ExpandContextNode.output_ports
        assert Facet.EMBEDDING in port.removes
        assert Facet.SCORE not in port.removes

    def test_the_expanded_item_keeps_its_score(self, session: Session) -> None:
        """The ranking stage downstream reads this score; expansion must not clear it."""
        store = _store({"doc": DOC})
        outputs = ExpandContextNode(_config(window=1)).run(
            {"items": ItemBatch(items=[_match("doc", 2, 0.77)])}, _context(session, store)
        )
        assert [item.score for item in _items(outputs)] == [0.77]

    def test_the_trace_reports_matches_in_against_expanded_out(self, session: Session) -> None:
        store = _store({"doc": DOC})
        node = ExpandContextNode(_config(window=1))
        inputs = {"items": ItemBatch(items=[_match("doc", 1), _match("doc", 2)])}
        outputs = node.run(inputs, _context(session, store))
        summary = node.summarize_io(inputs, outputs)
        expansion = next(value for value in summary.outputs if value.label == "Expansion")
        assert expansion.value == {
            "mode": "window",
            "window": 1,
            "matches_in": 2,
            "expanded_out": 1,
            "merged": 1,
            "documents_read": 1,
        }

    def test_the_store_read_is_bounded(self, session: Session) -> None:
        store = _store({"doc": DOC})
        ExpandContextNode(_config()).run(
            {"items": ItemBatch(items=[_match("doc", 0)])}, _context(session, store)
        )
        assert store.fetch_document_calls[0]["limit"] == MAX_DOCUMENT_CHUNKS
