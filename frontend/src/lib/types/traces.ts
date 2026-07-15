import type { UUID } from "@/lib/types/common";
import type {
  PipelineDefinition,
  PipelineIOType,
  PipelineKind,
  PipelineRunStatus,
} from "@/lib/types/pipelines";

export interface PipelineRunTrace {
  id: UUID;
  pipeline_id: UUID;
  pipeline_version_id?: UUID | null;
  pipeline_version?: number | null;
  kind: PipelineKind;
  user_id: UUID;
  collection_id: UUID;
  status: PipelineRunStatus;
  error_message?: string | null;
  warnings: string[];
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineNodeRunTrace {
  id: UUID;
  run_id: UUID;
  node_id: string;
  node_type: string;
  node_name: string;
  sequence_index: number;
  status: PipelineRunStatus;
  error_message?: string | null;
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  summary: PipelineNodeSummary;
  created_at: string;
  updated_at: string;
}

export interface PipelineNodeSummaryValue {
  label: string;
  value: unknown;
  kind?: "json" | "text" | "embedding" | "items";
}

export interface ItemRef {
  id: string;
  score?: number | null;
}

export interface ItemListTrace {
  kind: "chunks" | "matches";
  items: ItemRef[];
}

export interface PipelineNodeSummary {
  inputs: PipelineNodeSummaryValue[];
  outputs: PipelineNodeSummaryValue[];
}

export interface PipelineNodeIOTrace {
  id: UUID;
  run_id: UUID;
  node_run_id: UUID;
  node_id: string;
  io_type: PipelineIOType;
  port: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PipelineTraceResponse {
  run: PipelineRunTrace;
  definition: PipelineDefinition;
  node_runs: PipelineNodeRunTrace[];
  node_io: PipelineNodeIOTrace[];
}

/** `TraceOriginRead` — the source document + ingestion trace for a chunk. */
export interface TraceOrigin {
  document_id: UUID;
  document_name?: string | null;
  chunk_id?: string | null;
  trace: PipelineTraceResponse;
}

/** `FocusedItemRead` — the concrete chunk behind a focused trace item. */
export interface TraceFocusedItem {
  id: string;
  status: "resolved" | "missing";
  text?: string | null;
  document_id?: UUID | null;
  filename?: string | null;
  chunk_index?: number | null;
  chunk_count?: number | null;
}

/** `DocumentTraceResponse` — ingestion trace with one chunk resolved for focus. */
export interface DocumentTrace {
  trace: PipelineTraceResponse;
  focused_item?: TraceFocusedItem | null;
}

/** `EndToEndTraceResponse` — retrieval trace joined with chunk origin. */
export interface EndToEndTrace {
  retrieval: PipelineTraceResponse;
  origin?: TraceOrigin | null;
  focused_item?: TraceFocusedItem | null;
}
