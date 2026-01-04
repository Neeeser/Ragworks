import type { PipelineKind } from "@/lib/types";

export const PIPELINE_KINDS = ["ingestion", "retrieval"] as const;
export const PIPELINE_KIND_STORAGE_KEY = "transparentrag.pipeline.kind";

export const isPipelineKind = (value?: string | null): value is PipelineKind =>
  PIPELINE_KINDS.includes(value as PipelineKind);
