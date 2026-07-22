/**
 * Collection diagnostics wire types.
 *
 * Hand-mirrored from `app/schemas/diagnostics.py`; keep in sync in the same PR.
 * Every finding is a `CollectionDiagnostic` produced by a backend rule.
 */
import type { UUID } from "@/lib/types/common";

export type DiagnosticSeverity = "error" | "warning" | "info";
export type DiagnosticConfidence = "confirmed" | "heuristic";
export type DiagnosticCategory =
  | "pipeline_compatibility"
  | "embedding"
  | "index_config"
  | "backend_storage"
  | "data_freshness"
  | "run_failures"
  | "node_config";

export type DiagnosticResourceKind =
  | "collection"
  | "pipeline"
  | "node"
  | "field"
  | "index"
  | "namespace"
  | "run";

export type DiagnosticLinkKind = "pipeline" | "index" | "trace" | "diagnostic";

export interface DiagnosticResource {
  kind: DiagnosticResourceKind;
  id?: string | null;
  name?: string | null;
  pipeline_side?: "ingestion" | "retrieval" | null;
}

export interface DiagnosticObservation {
  label: string;
  ingestion?: string | null;
  retrieval?: string | null;
  value?: string | null;
}

export interface DiagnosticAction {
  label: string;
  route: string;
}

export interface DiagnosticLink {
  label: string;
  route: string;
  kind: DiagnosticLinkKind;
}

export interface CollectionDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  confidence: DiagnosticConfidence;
  category: DiagnosticCategory;
  title: string;
  summary: string;
  resources: DiagnosticResource[];
  observations: DiagnosticObservation[];
  action?: DiagnosticAction | null;
  links: DiagnosticLink[];
}

export interface CollectionDiagnosticsResponse {
  collection_id: UUID;
  generated_at: string;
  error_count: number;
  warning_count: number;
  consistent: boolean;
  diagnostics: CollectionDiagnostic[];
}
