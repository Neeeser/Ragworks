import type { Collection } from "@/lib/types/collections";
import type { IndexBackend, UUID } from "@/lib/types/common";
import type { PipelineValidationIssue } from "@/lib/types/pipelines";

/** Mirrors `app/schemas/setup.py::SetupStatusRead`. */
export interface SetupStatus {
  has_embedding_provider: boolean;
  has_chat_provider: boolean;
  has_vector_store: boolean;
  has_index: boolean;
  has_collection: boolean;
  setup_complete: boolean;
}

/** Mirrors `app/schemas/setup.py::RerankerChoice`. */
export interface RerankerChoice {
  connection_id: UUID;
  model_name: string;
}

/** Mirrors `app/schemas/setup.py::SetupBootstrapRequest`. */
export interface SetupBootstrapRequest {
  embedding_connection_id: UUID;
  embedding_model: string;
  embedding_dimension?: number | null;
  backend: IndexBackend;
  index_name: string;
  collection_name: string;
  chunk_size?: number;
  chunk_overlap?: number;
  add_count_tool?: boolean;
  add_facet_tool?: boolean;
  reranker?: RerankerChoice | null;
}

/** Mirrors `app/schemas/setup.py::SetupBootstrapResponse`. */
export interface SetupBootstrapResponse {
  collection: Collection;
  warnings: PipelineValidationIssue[];
}
