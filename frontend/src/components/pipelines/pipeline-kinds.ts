import type { PipelineKind } from "@/lib/types";

export const PIPELINE_KINDS = ["ingestion", "retrieval"] as const;
export const PIPELINE_KIND_STORAGE_KEY = "transparentrag.pipeline.kind";

/** Sentinel option value used by index <select> controls to trigger "open the index
 * manager" instead of selecting an actual index. */
export const CREATE_SENTINEL = "__create__";

export const isPipelineKind = (value?: string | null): value is PipelineKind =>
  PIPELINE_KINDS.includes(value as PipelineKind);
