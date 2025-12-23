import type { PipelineNodeExample } from "./PipelineNode";
import type { NodeSpec } from "@/lib/types";

type NodeContent = {
  description: string;
  example: PipelineNodeExample;
};

const NODE_CONTENT: Record<string, NodeContent> = {
  "ingestion.input": {
    description:
      "Starts ingestion by turning the uploaded file in the ingestion context into a Source payload. The payload carries the file path, content type, and metadata so downstream nodes never touch the filesystem directly.",
    example: {
      input: "Uploaded file: invoice.pdf (application/pdf)\nDocument id: 123",
      output:
        "Source payload\n- document_id: 123\n- path: /tmp/invoice.pdf\n- content_type: application/pdf\n- metadata: { collection_id, filename }",
    },
  },
  "parser.document": {
    description:
      "Reads the source file and extracts normalized text. Honors the mode config to force pdf or text parsing, otherwise it auto-detects using the content type.",
    example: {
      input: "Source payload: invoice.pdf (application/pdf)",
      output: 'Parsed document\n- text: "Invoice #42 ..."\n- metadata: document_id=123',
    },
  },
  "router.file_type": {
    description:
      "Inspects the source content type and routes the payload to the matching output port. Only the matching port is populated; the others remain empty.",
    example: {
      input: "Source payload content_type: application/pdf",
      output: "PDF output -> Source payload\nText output -> (empty)\nOther output -> (empty)",
    },
  },
  "chunker.collection": {
    description:
      "Splits the parsed document into smaller chunks using the node's configured strategy, size, and overlap. Each chunk keeps metadata so it can be traced back to the document.",
    example: {
      input: 'Parsed document text: "Hello world!"',
      output: 'Chunk batch\n- "Hello"\n- "world!"',
    },
  },
  "embedder.openrouter": {
    description:
      "Calls the configured OpenRouter embedding model for each chunk and attaches the vector plus usage metadata. The output is ready for Pinecone indexing.",
    example: {
      input: 'Chunks:\n- "Hello world!"',
      output: "Embeddings:\n- [0.12, -0.03, 0.44, ...]",
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
  "retriever.pinecone": {
    description:
      "Embeds the query, queries Pinecone for nearest neighbors, and returns scored matches with usage using the node configuration.",
    example: {
      input: 'Query request: "coffee grinders"',
      output: "Retrieval results\n- chunk A (score 0.82)\n- chunk B (score 0.79)\n- ...",
    },
  },
  "chat.settings": {
    description:
      "Stores the chat model and context window configuration used for generation alongside retrieval.",
    example: {
      input: "Chat settings configured",
      output: "No runtime output (configuration only)",
    },
  },
  "reranker.cross_encoder": {
    description:
      "When enabled, re-scores the retrieved matches with a cross-encoder model and reorders the list. When disabled, it passes results through unchanged.",
    example: {
      input: "Results: [chunk B (0.71), chunk A (0.68)]\nReranker enabled",
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
