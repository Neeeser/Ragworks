# Tracer Design Guide

The tracer is a diagnostic workbench for understanding how a document became a
retrieval result. It is not a raw event viewer and it is not a visualization added
after execution. Every tracer view should help answer a concrete debugging
question about a pipeline.

This guide records the design principles established while building and testing
the end-to-end tracer. Use it when changing trace data, adding node explanations,
or designing tracer interactions.

## The diagnostic model

A trace should let a user answer four questions:

1. What entered the pipeline?
2. What did each node change?
3. Why did this artifact reach its final position or form?
4. What pipeline setting should be investigated next?

Showing inputs and outputs is necessary, but it is not sufficient. Raw payloads
make users reconstruct the explanation themselves. The primary view should state
the node's effect in the vocabulary of that node: parsed text, created chunks,
embedding dimensions, retrieval rank, native score, fusion contribution, or final
delivery position. Configuration and raw payloads remain available as supporting
evidence.

The traced artifact is the stable subject of the investigation. Selecting a node
changes the evidence being examined, not the artifact being traced. A user should
be able to move backward and forward through execution without losing the result
they are trying to explain.

## Ingestion and retrieval are separate paths

Ingestion and retrieval describe different operations:

- Ingestion explains how a source file became indexed artifacts.
- Retrieval explains how a query caused indexed artifacts to be selected, ranked,
  combined, and delivered.

They are connected through the focused artifact, but they should not be drawn as
one continuous graph. Combining both stages produces crossing edges, synthetic
connector nodes, and an unclear execution story. The trace page therefore uses
separate **Ingestion** and **Retrieval** graph views while preserving a single
execution record and focused artifact.

The graph is still an important figure. It communicates pipeline structure and
makes the product's directed-graph model tangible. It should be smaller than the
primary evidence when necessary, but it should remain interactive: users must be
able to zoom with a mouse wheel or trackpad and drag to pan. Graph selection,
execution selection, playback, and the evidence panel must remain synchronized.

Do not add connector nodes solely to make the graph appear continuous. A visible
node should correspond to an operation that produced evidence a user can inspect.

## One focused artifact

Result tracing is anchored to one chunk or other retrievable artifact. The focused
artifact remains stable while the user:

- switches between ingestion and retrieval;
- selects execution nodes;
- follows the rank path;
- opens node explanations or raw data;
- inspects source context.

This prevents a common failure mode where clicking an upstream node silently
changes the entire trace subject. Changing the focused artifact must be an explicit
action such as **Trace result**.

Artifact identity is useful for linking data, but an identifier is not a useful
primary label. Prefer the source filename, source-relative path, chunk position,
and a readable excerpt. Show the identifier as secondary metadata when it is
needed for precise debugging.

## Each surface has one job

The trace page uses several coordinated views. They should not repeat the same
content.

### Graph

The graph shows structure, branches, and the selected execution path. It answers
"where did this operation occur?" It is not the place for long payloads or a full
ranking analysis.

### Rank path

The rank path summarizes how the focused result moved through retrieval. It should
show every stage that assigned a position or score and link directly to that
stage's evidence. It answers "where did this result gain or lose position?"

The model must be method-neutral. Future pipelines may introduce new retrievers,
rerankers, filters, or fusion methods. Build the path from trace evidence rather
than a fixed list of semantic, BM25, and RRF nodes.

### Execution order

Execution order is a chronological index of executed nodes. The word "journey" is
too abstract for this purpose. A row should show the node name, status, duration,
and one compact artifact effect when one exists.

Missing evidence is itself evidence. If the focused result is absent from a
node's returned set, show a compact negative-status badge. Put the exact statement,
such as "Not in this node's top 1," in a tooltip to avoid turning the ledger into a
wall of status text. Tooltips must open within the available pane or use an overlay
that cannot be clipped by adjacent panels.

Selecting an execution row should scroll it into a useful position instead of
placing it against the top edge. Preserve enough surrounding rows to retain the
execution context.

### Node evidence

Node evidence explains the selected operation. Its views have distinct purposes:

- **Explanation** presents a designed, domain-specific account of what changed.
- **Node data** presents structured inputs and outputs with appropriate renderers.
- **Configuration** shows the settings that affected the operation.
- **Raw payload** provides the unmodified trace record for low-level inspection.

The Explanation view should be the fastest path to a diagnosis. Node data and raw
payloads should not be the only way to understand a routine node.

### Artifact drawer

Long text and future media need a dedicated reader. Do not append a complete chunk,
document, or image to every explanation panel. Use short excerpts to establish
identity and context, then open the artifact in a drawer that has enough space to
render it properly.

The drawer is where full chunk text, parsed text, images, and other media can grow
without forcing each node renderer to solve document layout.

## Explain transformations, not containers

Node explanations should describe the meaningful transformation performed by the
node.

### Ingestion input

Show the user-facing source path used in the Files view, such as
`reports/paper.pdf`. Do not lead with an internal storage hash. The internal key may
appear as secondary metadata.

### Parse nodes

Show the input file and what the node produced from it — extracted text, embedded
media, rendered pages. A preview can establish what was parsed, but users must be
able to open the complete output. A file whose content type the node has no
handler for produced nothing, and the trace says so rather than showing an empty
result.

### Chunker

Show ordered chunks and make every chunk inspectable. A selected row can use a
longer excerpt, but do not render a second, smaller duplicate preview beneath the
list. Put **Open chunk** and **Trace result** on the selected chunk presentation.

Chunk order matters diagnostically. Users need to see boundaries, overlap, and
neighboring content to identify sentences or concepts split between chunks.

### Embedder

Show the embedding operation visually, including dimensions and model information.
Do not dump the full vector as the primary explanation. The raw vector belongs in
Node data or Raw payload.

### Indexers

Show what was indexed, where it was indexed, and the artifact's position or key
when that information is meaningful. Keep internal identifiers subordinate to
source identity.

### Retrievers

Show result order, native score, and a readable excerpt for every returned result.
The focused result should remain visible even when it is absent from the returned
set, with that absence stated explicitly.

Native scores are not directly comparable across arbitrary retrieval methods. Label
them by stage and preserve their native meaning instead of implying a shared scale.

### Fusion and reranking

Explain how each input branch affected the final position. For reciprocal-rank
fusion, contribution bars communicate branch influence faster than a table of
source, rank, score, and contribution columns. Keep the numerical values available,
but make relative influence visually apparent.

A useful fusion explanation reads as a sequence: semantic rank, lexical rank, each
branch's contribution, fused rank, and final delivery rank. If both branches agree,
say so through the evidence. If fusion rescues or lowers a result, make that change
visible.

## Ranking is a movement story

Retrieval debugging is usually about position, not only presence. For the focused
result, each ranking stage should expose:

- whether the result was returned;
- its rank within that stage's returned set;
- its native score, when one exists;
- its contribution to a combined score, when applicable;
- its rank after combination or reranking;
- its final delivered rank.

Avoid forcing the user to open semantic retrieval, lexical retrieval, fusion, and
output panels merely to reconstruct one result's path. The rank path provides the
compact overview; linked node explanations provide the detail.

Ranking lists should favor comparison. Use a sentence-length contextual excerpt,
not a two-line fragment that conveys nothing and not the full chunk text. Collapse
long text by default and provide an explicit reader action.

## Source context and document context

These are different operations and must not share an ambiguous label:

- **Surrounding chunks** means chunks adjacent to the focused chunk in the source
  document's order.
- **Open document** means the complete source document or the best available
  reconstructed representation.

Retrieval-result order is not source order. Never infer previous or next chunks
from the order in which a retriever returned them. Resolve neighbors by stable
document identity and chunk position.

Ragworks already records document identity and chunk position for stored chunks.
The current context API can return trace-recorded neighbors that are not actually
adjacent in source order, so UI code must not label the nearest returned item as
"previous" or "next." Correct source context should request explicit positions
such as `chunk_index - 1`, `chunk_index`, and `chunk_index + 1` for the same
document.

The complete original document should be a separate reader mode. This distinction
also leaves room for PDFs, images, page-aware parsing, and other media where
"concatenate every chunk" is not an adequate representation of the source.

## Avoid walls of text and walls of empty structure

Dense trace data creates two opposite design failures:

- A wall of text appears when every list renders complete payloads.
- A wall of empty structure appears when large cards contain only one or two
  truncated lines that do not help the user.

Use progressive disclosure:

1. Show identity, rank or transformation, and a useful excerpt.
2. Expand structured evidence in place when comparison benefits from it.
3. Open complete artifacts in the drawer.
4. Keep raw payloads available in their dedicated view.

Extra clicks are acceptable when each click enters a clearer, purpose-built view.
Extra clicks are not acceptable when they repeat the same preview or make the user
visit several panels to reconstruct one fact.

## Interaction language

Use direct engineering terms:

- **Trace result** opens the end-to-end trace for one result.
- **Trace query** opens the execution trace without selecting a result.
- **Open chunk** opens the complete focused chunk.
- **Surrounding chunks** opens source-adjacent context.
- **Open document** opens the complete source representation.

Avoid "Focus result" as a user-facing action. Focus is internal tracer state;
trace is the task the user intends to perform. Avoid several controls with nearly
identical meanings, such as Open chunk, Inspect result, Focus trace, and Focus
result.

Comparison must remain anchored to the focused artifact. Previous/next navigation
that silently replaces the focused artifact changes the investigation rather than
adding context. If comparison is introduced, label both subjects and retain the
focused artifact as the reference.

## Extensibility rules

The tracer must accommodate nodes and artifact types that do not exist yet.

### Render by evidence shape

Trace value displays use an ordered renderer registry selected by payload shape.
Add a focused renderer and shape guard for a new evidence type instead of adding a
node-type switch to the tracer. The normalized JSON renderer remains the fallback.

### Keep ranking stages generic

Do not encode assumptions that every retrieval pipeline contains semantic search,
BM25, and RRF. A new retriever should participate when it emits the standard result
identity, ordering, and score evidence. A new combiner should be able to expose its
own contribution or transformation vocabulary.

### Separate identity from presentation

Focused artifacts need stable identity across nodes, while their presentation may
change by type. Text chunks, images, pages, tables, and generated representations
should share focus and trace contracts without sharing one text-only component.

### Preserve complete evidence

Designed explanations should not replace raw evidence. Store enough information to
reproduce ranks, transformations, and configuration, then derive explanatory UI
from it. Do not store UI sentences as trace data.

## Lessons from blind usability testing

A blind test used one query whose correct result ranked first and one query whose
answer crossed a zero-overlap chunk boundary.

In the successful case, BM25 and semantic retrieval both ranked the correct chunk
first, and fusion preserved that agreement. The tracer made this clear, but the
tester initially had to visit each retrieval node to reconstruct the story.

In the failure case, one chunk ended with "Ragworks uses OpenRouter for" and the
next began with "embeddings and chat models." With a chunk size of 496 and no
overlap, both retrieval branches ranked the continuation first while the chunk
containing the provider name ranked lower. Fusion faithfully amplified their shared
preference. The failure was caused by a content boundary, not by fusion.

The test produced several durable lessons:

- A result can rank first and still be incomplete.
- Neighboring source context is essential for diagnosing chunk-boundary failures.
- Independent branch agreement is meaningful evidence and should be visible.
- Final score alone does not explain a ranking.
- Repeated long snippets make cross-branch comparison slower.
- Navigating away from results or changing the focused artifact creates context
  loss.
- The rank path and contribution visualization reduce mental reconstruction.
- A diagnostic UI should point toward an actionable pipeline change. In this case,
  adding chunk overlap and re-ingesting was the first experiment supported by the
  evidence.

Blind tests should continue to include both a positive case and a deliberately bad
result. A tracer that only demonstrates successful retrieval is not being tested as
a debugging tool.

## Review checklist

Before merging a tracer change, verify the following:

- The focused artifact remains stable while selecting nodes and stages.
- Ingestion and retrieval remain visually distinct.
- The graph supports wheel and trackpad zoom plus drag-to-pan.
- Graph, playback, execution order, rank path, and evidence selection agree.
- Every visible node represents an executed, inspectable operation.
- The explanation states what the node changed.
- Long values have a complete reader path.
- Ranking stages show presence, rank, native score, and contribution where
  applicable.
- Missing results are clear without adding persistent text clutter.
- Source neighbors come from document order, not retrieval order.
- Action labels describe the user's task and are not redundant.
- New behavior is driven by evidence shape rather than hardcoded node types.
- Dense lists remain scannable in both light and dark themes.
- Tooltips, drawers, and overlays are not clipped by adjacent panes.
- Keyboard focus, reduced motion, loading states, and browser back navigation work.
- A realistic positive and negative retrieval trace have been tested end to end.

The tracer succeeds when a user can move from "this result is wrong" to a specific,
evidence-supported pipeline experiment without reading application code or manually
reconstructing the execution from raw JSON.
