import type { PipelineNodeExample } from "../PipelineNode";
import type { NodeSpec } from "@/lib/types";

type NodeContent = {
  description: string;
  example: PipelineNodeExample;
};

const QUERY_EMBEDDING_EXAMPLE_INPUT = "Query embedding: [0.12, -0.03, 0.44, ...]";
const RETRIEVAL_RESULTS_EXAMPLE_OUTPUT =
  "Retrieval results\n- chunk A (score 0.82)\n- chunk B (score 0.79)\n- ...";

const NODE_CONTENT: Record<string, NodeContent> = {
  "ingestion.input": {
    description:
      "Starts ingestion by emitting the uploaded file as one item carrying the file itself — its stored path, content type, size, and metadata. Parse nodes read that item, so nothing downstream touches the filesystem directly.",
    example: {
      input: "Uploaded file: invoice.pdf (application/pdf)\nDocument id: 123",
      output:
        "Items\n- 1 file: /tmp/invoice.pdf (application/pdf)\n- metadata: { collection_id, document_id, filename }",
    },
  },
  "parse.text": {
    description:
      "Extracts a file's text through the handler registered for its content type, emitting one text item per file. A type no handler answers for is skipped with a trace warning, or decoded as plain text when configured that way. Items carrying no file pass through untouched.",
    example: {
      input: "Items\n- 1 file: invoice.pdf (application/pdf)",
      output: 'Items\n- 1 text: "Invoice #42 ..."',
    },
  },
  "parse.media_file": {
    description:
      "Reads an uploaded image as one item carrying the image itself, so a vision node or a multimodal embedding model can work on it. Files of any other type pass through untouched.",
    example: {
      input: "Items\n- 1 file: diagram.png (image/png)",
      output: "Items\n- 1 image (200x120, image/png)",
    },
  },
  "parse.embedded_media": {
    description:
      "Pulls the images embedded in a document out as one item each. Images below the configured size are skipped, since page furniture is embedded the same way as figures.",
    example: {
      input: "Items\n- 1 file: report.pdf (application/pdf)",
      output: "Items\n- page 1 image (480x320)\n- page 4 image (960x540)",
    },
  },
  "parse.page_images": {
    description:
      "Rasterizes a document's pages at the configured resolution, one image item per page — the intake path for documents whose layout carries meaning a text extractor drops.",
    example: {
      input: "Items\n- 1 file: report.pdf (application/pdf)",
      output: "Items\n- page 1 image (1275x1650)\n- page 2 image (1275x1650)",
    },
  },
  "merge.items": {
    description:
      "Concatenates every inbound item stream into one, in run order. Parallel intake branches meet here so one describe, embed, and index chain serves all of them.",
    example: {
      input: "Items(3 text) + Items(2 images)",
      output: "Items(5)",
    },
  },
  "llm.describe": {
    description:
      "Sends each image item to a vision model and writes what it returns onto the item — a searchable description, or the text read out of it. Items carrying no image pass through untouched.",
    example: {
      input: "Items\n- page 1 image (480x320)",
      output: 'Items\n- page 1 image + "A bar chart of quarterly revenue, Q1-Q4"',
    },
  },
  "chunker.collection": {
    description:
      "Splits text items into smaller chunks using the node's configured strategy, size, and overlap. Each chunk keeps metadata so it can be traced back to the document, and items carrying no text pass through untouched.",
    example: {
      input: 'Text item: "Hello world!"',
      output: 'Chunk batch\n- "Hello"\n- "world!"',
    },
  },
  "chunker.token": {
    description:
      "Splits text items into token-based chunks using the configured size and overlap. Useful when you want chunking to match model tokenization.",
    example: {
      input: 'Text item: "Hello world!"',
      output: 'Chunk batch\n- "Hello"\n- "world!"',
    },
  },
  "chunker.sentence": {
    description:
      "Splits text items into sentence-based chunks with overlap for smoother context windows.",
    example: {
      input: 'Text item: "Hello world. This is another sentence."',
      output: 'Chunk batch\n- "Hello world."\n- "This is another sentence."',
    },
  },
  "chunker.paragraph": {
    description:
      "Splits text items into paragraph-based chunks while preserving whitespace between paragraphs.",
    example: {
      input: "Text item with paragraphs",
      output: "Chunk batch\n- Paragraph 1\n- Paragraph 2",
    },
  },
  "chunker.semantic": {
    description:
      "Splits text items into semantically coherent chunks based on embeddings and boundaries.",
    example: {
      input: "Text item with topic shifts",
      output: "Chunk batch\n- Topic A\n- Topic B",
    },
  },
  "embedder.text": {
    description:
      "Calls the embedding model on the configured provider connection to embed chunks or a query request. It attaches vectors plus usage metadata for downstream indexing or retrieval.",
    example: {
      input: 'Query request: "Hello world!"',
      output: "Query embedding:\n- [0.12, -0.03, 0.44, ...]",
    },
  },
  "indexer.vector": {
    description:
      "Writes embedded chunks into the vector index you pick — pgvector (built-in Postgres) or Pinecone. It can auto-create the index and returns the indexing payload for final persistence.",
    example: {
      input: "Embedded chunks (2 vectors)\nTarget index: rag-prod / docs",
      output: "Indexed batch\n- upserted: 2\n- index: rag-prod\n- namespace: docs",
    },
  },
  "indexer.pinecone": {
    description:
      "Upserts embedded chunks into the configured Pinecone index and namespace. It can auto-create the index and returns the indexing payload for final persistence.",
    example: {
      input: "Embedded chunks (2 vectors)\nTarget index: rag-prod / docs",
      output: "Indexed batch\n- upserted: 2\n- index: rag-prod\n- namespace: docs",
    },
  },
  "indexer.pgvector": {
    description:
      "Upserts embedded chunks into the built-in Postgres (pgvector) index and namespace. It can auto-create the index and returns the indexing payload for final persistence.",
    example: {
      input: "Embedded chunks (2 vectors)\nTarget index: ragworks / docs",
      output: "Indexed batch\n- upserted: 2\n- index: ragworks\n- namespace: docs",
    },
  },
  "indexer.bm25": {
    description:
      "Writes chunk text into a sparse BM25 index for exact-term (lexical) search — no embeddings involved. Wire it straight from the chunker; it runs in parallel with the embed → semantic-index path.",
    example: {
      input: "Chunks (2 texts)\nTarget index: ragworks-bm25 / docs",
      output: "Indexed batch\n- upserted: 2\n- index: ragworks-bm25\n- namespace: docs",
    },
  },
  "ingestion.output": {
    description:
      "Terminal node that passes indexed chunks through as the pipeline result. Use it to finish ingestion runs.",
    example: {
      input: "Indexed batch with 2 chunks",
      output: "Result payload (indexed batch)",
    },
  },
  "retrieval.input": {
    description:
      "Builds a query request from the runtime context (query string, top_k, and namespace). This is the entry point for retrieval pipelines.",
    example: {
      input: 'Query: "coffee grinders"\nTop K: 5',
      output: 'Query request\n- text: "coffee grinders"\n- top_k: 5\n- namespace: docs',
    },
  },
  "retriever.vector": {
    description:
      "Queries the vector index you pick — pgvector (built-in Postgres) or Pinecone — with a precomputed query embedding and returns scored matches with usage metadata.",
    example: {
      input: QUERY_EMBEDDING_EXAMPLE_INPUT,
      output: RETRIEVAL_RESULTS_EXAMPLE_OUTPUT,
    },
  },
  "retriever.pinecone": {
    description:
      "Queries Pinecone with a precomputed query embedding and returns scored matches with usage metadata.",
    example: {
      input: QUERY_EMBEDDING_EXAMPLE_INPUT,
      output: RETRIEVAL_RESULTS_EXAMPLE_OUTPUT,
    },
  },
  "retriever.pgvector": {
    description:
      "Queries the built-in Postgres (pgvector) index with a precomputed query embedding and returns scored matches with usage metadata.",
    example: {
      input: QUERY_EMBEDDING_EXAMPLE_INPUT,
      output: RETRIEVAL_RESULTS_EXAMPLE_OUTPUT,
    },
  },
  "retriever.bm25": {
    description:
      "Queries a sparse BM25 index with the raw query text for exact-term (lexical) matches — no embeddings involved. Wire it straight from the retrieval input, in parallel with the embed → semantic-retrieve path.",
    example: {
      input: 'Query request\n- text: "error E1042"\n- top_k: 5',
      output: RETRIEVAL_RESULTS_EXAMPLE_OUTPUT,
    },
  },
  "fusion.rrf": {
    description:
      "Combines results from any number of retrievers by reciprocal rank — robust fusion when branch scores aren't comparable (semantic cosine vs BM25). Chunks found by several branches rise to the top.",
    example: {
      input: "Semantic: [chunk A, chunk B]\nBM25: [chunk B, chunk C]",
      output: "Fused results: [chunk B, chunk A, chunk C]",
    },
  },
  "reranker.model": {
    description:
      "Re-scores every retrieved candidate with the selected model on the configured provider connection and returns the complete reordered list.",
    example: {
      input: "Results: [chunk B (0.71), chunk A (0.68)]",
      output: "Results: [chunk A (0.88), chunk B (0.74)]",
    },
  },
  "retrieval.output": {
    description: "Terminal node that exposes the final retrieval results to the API response.",
    example: {
      input: "Retrieval results with 5 matches",
      output: "Result payload (same 5 matches)",
    },
  },
};

export const resolveNodeDescription = (spec: NodeSpec) =>
  NODE_CONTENT[spec.type]?.description ?? spec.description;

export const resolveNodeExample = (spec: NodeSpec) => NODE_CONTENT[spec.type]?.example;
