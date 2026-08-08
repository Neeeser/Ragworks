import type { PipelineKind } from "@/lib/types";

export const PIPELINE_KINDS = ["ingestion", "retrieval"] as const;
export const PIPELINE_KIND_STORAGE_KEY = "ragworks.pipeline.kind";

/** Sentinel option value used by index <select> controls to trigger "open the index
 * manager" instead of selecting an actual index. */
export const CREATE_SENTINEL = "__create__";

/** Display names for the two kinds — the tool vocabulary the product uses. */
export const PIPELINE_KIND_LABELS: Record<PipelineKind, string> = {
  ingestion: "Ingestion",
  retrieval: "Tools",
};

/**
 * URL segment per kind. `retrieval` is the wire value the API speaks; `tools`
 * is what the segment reads as, so the URL matches the tab and the rest of the
 * product's vocabulary.
 */
export const PIPELINE_KIND_SLUGS: Record<PipelineKind, string> = {
  ingestion: "ingestion",
  retrieval: "tools",
};

/**
 * Retired segments that still redirect. Links to `/pipelines/retrieval` are in
 * bookmarks and pasted URLs, so dropping the segment 404s them.
 */
export const LEGACY_PIPELINE_SLUGS: Record<string, string> = {
  retrieval: PIPELINE_KIND_SLUGS.retrieval,
};

export const isPipelineKind = (value?: string | null): value is PipelineKind =>
  PIPELINE_KINDS.includes(value as PipelineKind);

/** Resolve a URL segment to the kind the API speaks, or null when it names none. */
export const pipelineKindFromSlug = (slug?: string | null): PipelineKind | null =>
  PIPELINE_KINDS.find((kind) => PIPELINE_KIND_SLUGS[kind] === slug) ?? null;

/** The route a kind's editor lives at. */
export const pipelineKindHref = (kind: PipelineKind): string =>
  `/pipelines/${PIPELINE_KIND_SLUGS[kind]}`;
