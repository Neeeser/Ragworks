import type { PipelineKind } from "@/lib/types";

export const PIPELINE_KINDS = ["ingestion", "retrieval"] as const;
export const PIPELINE_KIND_STORAGE_KEY = "ragworks.pipeline.kind";

/** Sentinel option value used by index <select> controls to trigger "open the index
 * manager" instead of selecting an actual index. */
export const CREATE_SENTINEL = "__create__";

/**
 * Display names for the two kinds. The `retrieval` route param is permanent
 * (persisted URLs and stored preferences use it); the label says Tools, which
 * is what these pipelines are called everywhere else in the product.
 */
export const PIPELINE_KIND_LABELS: Record<PipelineKind, string> = {
  ingestion: "Ingestion",
  retrieval: "Tools",
};

export const isPipelineKind = (value?: string | null): value is PipelineKind =>
  PIPELINE_KINDS.includes(value as PipelineKind);
