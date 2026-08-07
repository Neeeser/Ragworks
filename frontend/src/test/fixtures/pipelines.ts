/**
 * Pipeline fixtures — the pipeline itself, its versions, the node specs the
 * editor renders from, and a validation result.
 */
import { RETRIEVER_LABEL, RETRIEVER_TYPE, USER_ID } from "./constants";
import { TIMESTAMP } from "./files";

import type {
  NodeSpec,
  Pipeline,
  PipelineValidationResult,
  PipelineVersion,
  ToolTemplate,
} from "@/lib/types";

/** The shipped tool-template catalog the wizard renders, as the API serves it. */
export function makeToolTemplates(): ToolTemplate[] {
  const base = {
    needs_embedding: false,
    needs_reranker: false,
    needs_store: true,
    index_vector_type: "dense" as ToolTemplate["index_vector_type"],
    supported_backends: ["pgvector", "pinecone"] as ToolTemplate["supported_backends"],
  };
  return [
    {
      ...base,
      id: "semantic-keyword",
      label: "Semantic + keyword search",
      description: "Dense vector search fused with BM25 keyword matching.",
      needs_embedding: true,
    },
    {
      ...base,
      id: "reranked",
      label: "Reranked search",
      description: "Hybrid search that over-fetches and reorders with a reranking model.",
      needs_embedding: true,
      needs_reranker: true,
    },
    {
      ...base,
      id: "count",
      label: "Count matches",
      description: "Counts how many documents and chunks lexically match the query.",
      index_vector_type: "sparse",
      supported_backends: ["pgvector"],
    },
    {
      ...base,
      id: "facet",
      label: "Facet by source",
      description: "Groups matching chunks by source file.",
      index_vector_type: "sparse",
      supported_backends: ["pgvector"],
    },
    {
      ...base,
      id: "blank",
      label: "Blank pipeline",
      description: "Start from just a query input and build the graph yourself.",
      needs_store: false,
      index_vector_type: null,
    },
  ];
}

export function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "pipe-1",
    user_id: USER_ID,
    name: "Retrieval",
    description: null,
    kind: "retrieval",
    current_version: 1,
    is_default: false,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    validation_issues: [],
    definition: {
      nodes: [
        {
          id: "node-1",
          type: RETRIEVER_TYPE,
          name: RETRIEVER_LABEL,
          config: { backend: "pgvector", index_name: "ragworks" },
        },
      ],
      edges: [],
    },
    ...overrides,
  };
}

export function makePipelineVersion(overrides: Partial<PipelineVersion> = {}): PipelineVersion {
  return {
    id: "ver-1",
    pipeline_id: "pipe-1",
    version: 1,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    change_summary: null,
    created_by: USER_ID,
    changes: [],
    ...overrides,
  };
}

export function makeNodeSpec(overrides: Partial<NodeSpec> = {}): NodeSpec {
  return {
    type: RETRIEVER_TYPE,
    label: RETRIEVER_LABEL,
    category: "retrieval",
    description: "Query a vector index",
    example: "",
    input_ports: [
      {
        key: "in",
        label: "In",
        data_type: "any",
        required: false,
        accepts_many: false,
        requires: [],
        adds: [],
        accepts: [],
        unaccepted: "passthrough" as const,
        preserves: false,
        removes: [],
      },
    ],
    output_ports: [
      {
        key: "out",
        label: "Out",
        data_type: "any",
        required: false,
        accepts_many: false,
        requires: [],
        adds: [],
        accepts: [],
        unaccepted: "passthrough" as const,
        preserves: false,
        removes: [],
      },
    ],
    config_schema: {},
    default_config: {},
    hidden: false,
    supported_backends: null,
    ...overrides,
  };
}

export function makeValidation(
  overrides: Partial<PipelineValidationResult> = {},
): PipelineValidationResult {
  return { valid: true, errors: [], warnings: [], issues: [], ...overrides };
}
