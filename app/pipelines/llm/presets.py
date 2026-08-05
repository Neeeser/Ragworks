"""Shipped presets for the LLM node shells.

Named methods are seeded configs, not node types: dropping a preset from
the editor's library instantiates the shell with these values, fully
editable. Prompts are engineering defaults — contextual retrieval follows
Anthropic's published prompt shape; the rest state their task plainly.
"""

from __future__ import annotations

from app.pipelines.node import NodePreset

TRANSFORM_PRESETS: tuple[NodePreset, ...] = (
    NodePreset(
        id="contextual-retrieval",
        label="Contextual Retrieval",
        description=(
            "Prepend a short document-situating context to every chunk before "
            "embedding, so retrieval sees the chunk with its surroundings. "
            "Wire the parser into the document input."
        ),
        config={
            "system_prompt": "",
            "prompt": (
                "<document>\n{{document_text}}\n</document>\n\n"
                "Here is the chunk we want to situate within the whole "
                "document:\n<chunk>\n{{text}}\n</chunk>\n\n"
                "Give a short succinct context to situate this chunk within "
                "the overall document for the purposes of improving search "
                "retrieval of the chunk."
            ),
            # The context is prepended to every chunk, so it spends the
            # embedding model's input limit. A couple of sentences fit well
            # inside this; leaving it unset would let one long answer push
            # every chunk past the limit and into the embedding guard.
            "max_output_tokens": 150,
            "output_fields": [
                {
                    "name": "context",
                    "type": "string",
                    "description": "One or two sentences situating the chunk in the document.",
                    "target": {"kind": "text", "mode": "prepend", "separator": "\n\n"},
                }
            ],
        },
    ),
    NodePreset(
        id="metadata-extractor",
        label="Metadata Extractor",
        description=(
            "Extract named fields from every chunk into its metadata, ready "
            "for metadata filters on the retrieval side. Edit the fields to "
            "match your corpus."
        ),
        config={
            "system_prompt": "You extract precise metadata from text.",
            "prompt": (
                "Extract the requested fields from this text. Use empty "
                "values where the text states nothing.\n\n{{text}}"
            ),
            "output_fields": [
                {
                    "name": "topic",
                    "type": "string",
                    "description": "The main topic of the text, in a few words.",
                    "target": {"kind": "metadata", "key": "topic"},
                },
                {
                    "name": "entities",
                    "type": "string_list",
                    "description": "Named people, organizations, and products mentioned.",
                    "target": {"kind": "metadata", "key": "entities"},
                },
            ],
        },
    ),
    NodePreset(
        id="summarize",
        label="Summarize",
        description="Replace each item's text with a concise summary of it.",
        config={
            "system_prompt": "You write faithful, concise summaries.",
            "prompt": "Summarize this text in a few sentences:\n\n{{text}}",
            "output_fields": [
                {
                    "name": "summary",
                    "type": "string",
                    "description": "A concise summary of the text.",
                    "target": {"kind": "text", "mode": "replace", "separator": "\n\n"},
                }
            ],
        },
    ),
)

RERANK_PRESETS: tuple[NodePreset, ...] = (
    NodePreset(
        id="llm-reranker",
        label="LLM Reranker",
        description=(
            "Score every retrieved chunk against the query in one listwise "
            "call and reorder by the scores."
        ),
        config={
            "system_prompt": (
                "You are a search relevance judge. Score each numbered "
                "passage for how well it answers the query."
            ),
            "prompt": (
                "Query: {{query}}\n\nPassages:\n{{items}}\n\n"
                "Score every passage from 0 (irrelevant) to 1 (directly "
                "answers the query). Return one result per passage."
            ),
            "output_fields": [
                {
                    "name": "score",
                    "type": "number",
                    "description": "Relevance of this passage to the query, 0 to 1.",
                    "target": {"kind": "score"},
                }
            ],
        },
    ),
    NodePreset(
        id="llm-judge",
        label="LLM Judge",
        description=(
            "Score chunks like the reranker, then drop everything scoring below the threshold."
        ),
        config={
            "system_prompt": (
                "You are a strict relevance judge. Score each numbered "
                "passage for whether it truly helps answer the query."
            ),
            "prompt": (
                "Query: {{query}}\n\nPassages:\n{{items}}\n\n"
                "Score every passage from 0 (irrelevant) to 1 (directly "
                "answers the query). Return one result per passage."
            ),
            "drop_below": 0.5,
            "output_fields": [
                {
                    "name": "score",
                    "type": "number",
                    "description": "Relevance of this passage to the query, 0 to 1.",
                    "target": {"kind": "score"},
                }
            ],
        },
    ),
)

GENERATE_PRESETS: tuple[NodePreset, ...] = (
    NodePreset(
        id="hyde",
        label="HyDE",
        description=(
            "Hypothetical document embeddings: write a passage that would "
            "answer the query, and retrieve with that instead of the query."
        ),
        config={
            "system_prompt": "You write plausible reference passages.",
            "prompt": (
                "Write one short passage that would directly answer this "
                "question, as it might appear in a reference document:\n\n{{text}}"
            ),
            "include_original": False,
            "output_fields": [
                {
                    "name": "passages",
                    "type": "string_list",
                    "description": "Exactly one hypothetical answer passage.",
                    "target": {"kind": "items"},
                }
            ],
        },
    ),
    NodePreset(
        id="query-expansion",
        label="Query Expansion",
        description=(
            "Rewrite the query several ways and retrieve with all of them; "
            "the retriever merges the results."
        ),
        config={
            "system_prompt": "You rewrite search queries to improve recall.",
            "prompt": (
                "Rewrite this search query three different ways — vary the "
                "phrasing and vocabulary while keeping the meaning:\n\n{{text}}"
            ),
            "include_original": True,
            "output_fields": [
                {
                    "name": "queries",
                    "type": "string_list",
                    "description": "Three rewrites of the query.",
                    "target": {"kind": "items"},
                }
            ],
        },
    ),
    NodePreset(
        id="query-planner",
        label="Query Planner",
        description=(
            "Decompose a complex question into the sub-queries needed to "
            "answer it, and retrieve for each."
        ),
        config={
            "system_prompt": (
                "You plan retrieval: break questions into the smallest set "
                "of searches that together answer them."
            ),
            "prompt": (
                "Decompose this question into the distinct search queries "
                "needed to answer it (one per aspect, at most four):\n\n{{text}}"
            ),
            "include_original": False,
            "output_fields": [
                {
                    "name": "sub_queries",
                    "type": "string_list",
                    "description": "The distinct sub-queries to search for.",
                    "target": {"kind": "items"},
                }
            ],
        },
    ),
)

DESCRIBE_PRESETS: tuple[NodePreset, ...] = (
    NodePreset(
        id="describe-image",
        label="Describe Image",
        description=(
            "Write a searchable description of every image item, so images "
            "are found by what they show. Pair with a text index."
        ),
        config={
            "system_prompt": (
                "You describe images for search. State what the image shows, "
                "including any text, labels, and figures visible in it."
            ),
            "prompt": (
                "Describe this image so someone searching for its contents "
                "would find it. Include any visible text and, for a chart or "
                "diagram, what it depicts and its labels."
            ),
            # A description is prepended to nothing and embedded on its own,
            # so this bounds the item, not a chunk window.
            "max_output_tokens": 300,
            "output_fields": [
                {
                    "name": "description",
                    "type": "string",
                    "description": "A searchable description of the image.",
                    # Append rather than replace: an image item usually has
                    # no text at all (identical outcome), and where one does
                    # carry text this keeps it instead of discarding it.
                    "target": {"kind": "text", "mode": "append", "separator": "\n\n"},
                }
            ],
        },
    ),
    NodePreset(
        id="read-text",
        label="Read Text (OCR)",
        description=(
            "Transcribe the text visible in every image item, for scanned "
            "pages and screenshots whose content is text."
        ),
        config={
            "system_prompt": (
                "You transcribe text from images exactly as it appears, "
                "preserving reading order."
            ),
            "prompt": (
                "Transcribe all text visible in this image, preserving its "
                "reading order. Return an empty string if it contains none."
            ),
            # A scanned page is long; a description-sized budget would cut
            # transcriptions off mid-page, which the model cannot signal.
            "max_output_tokens": 1500,
            "output_fields": [
                {
                    "name": "text",
                    "type": "string",
                    "description": "The text transcribed from the image.",
                    "target": {"kind": "text", "mode": "append", "separator": "\n\n"},
                }
            ],
        },
    ),
)
