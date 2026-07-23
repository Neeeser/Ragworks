import type { UsageBreakdown } from "@/lib/types/chat";
import type { CollectionQueryArgument, QueryChunk } from "@/lib/types/collections";
import type { UUID } from "@/lib/types/common";

/** Mirrors `app/schemas/tools.py::ToolResultKind`. */
export type ToolResultKind = "chunks" | "structured";

/** One tool binding's LLM-facing projection (`CollectionToolRead`). */
export interface CollectionTool {
  id: UUID;
  collection_id: UUID;
  pipeline_id: UUID;
  pipeline_name: string;
  name: string;
  base_name: string;
  description: string;
  parameters: Record<string, unknown>;
  arguments: CollectionQueryArgument[];
  output_kind: ToolResultKind;
  output_fields: string[];
  is_primary: boolean;
  enabled: boolean;
  position: number;
}

/** Mirrors `app/schemas/tools.py::CollectionToolsResponse`. */
export interface CollectionToolsResponse {
  tools: CollectionTool[];
  ingest_pipeline_id?: UUID | null;
}

/** Mirrors `app/schemas/tools.py::ToolInvokeRequest`. */
export interface ToolInvokeRequest {
  query: string;
  top_k?: number | null;
  arguments?: Record<string, unknown>;
}

/** Mirrors `app/schemas/tools.py::ToolInvocationResponse`. */
export interface ToolInvocationResponse {
  kind: ToolResultKind;
  tool_binding_id: UUID;
  query: string;
  top_k: number;
  chunks: QueryChunk[];
  outputs: Record<string, unknown>;
  usage: UsageBreakdown;
  query_event_id?: UUID | null;
  pipeline_run_id?: UUID | null;
}

/** Mirrors `app/schemas/tools.py::CollectionToolCreate`. */
export interface CollectionToolCreatePayload {
  pipeline_id: UUID;
}

/** Mirrors `app/schemas/tools.py::CollectionToolUpdate`. */
export interface CollectionToolUpdatePayload {
  is_primary?: boolean;
  enabled?: boolean;
}
