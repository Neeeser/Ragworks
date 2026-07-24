import type { BackendInfo, VectorIndex } from "@/lib/types";

export function makeVectorIndex(overrides: Partial<VectorIndex> = {}): VectorIndex {
  return {
    name: "index-1",
    backend: "pgvector",
    vector_type: "dense",
    metric: "cosine",
    dimension: 1536,
    status: { ready: true, state: "Ready" },
    host: "index-1.pinecone.io",
    deletion_protection: "disabled",
    ...overrides,
  };
}

export function makeBackendInfo(overrides: Partial<BackendInfo> = {}): BackendInfo {
  return {
    backend: "pgvector",
    label: "pgvector (PostgreSQL)",
    available: true,
    configured: true,
    lexical_available: true,
    capabilities: {
      max_dimension: 2000,
      supported_metrics: ["cosine", "l2", "dotproduct"],
      supported_vector_types: ["dense", "sparse"],
      index_name_max_length: 45,
      max_upsert_batch: 1000,
      max_top_k: 10000,
      requires_api_key: false,
      supports_lexical_count: true,
      supports_lexical_facet: true,
    },
    ...overrides,
  };
}

export function makePineconeBackendInfo(overrides: Partial<BackendInfo> = {}): BackendInfo {
  return makeBackendInfo({
    backend: "pinecone",
    label: "Pinecone",
    configured: true,
    capabilities: {
      max_dimension: 20000,
      supported_metrics: ["cosine", "euclidean", "dotproduct"],
      supported_vector_types: ["dense", "sparse"],
      index_name_max_length: 45,
      max_upsert_batch: 1000,
      max_top_k: 10000,
      requires_api_key: true,
      // Pinecone serves sparse indexes but has no count/facet aggregation API.
      supports_lexical_count: false,
      supports_lexical_facet: false,
    },
    ...overrides,
  });
}
