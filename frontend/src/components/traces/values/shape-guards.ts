import type { ItemListTrace, RankingEvidence } from "@/lib/types";

/**
 * Structural guards for the trace summary/payload value shapes the backend
 * emits (`app/pipelines/tracing/summaries.py`). The value-view registry uses
 * these to pick the right renderer; matching on shape (not just the coarse
 * `kind` hint) keeps it robust as new summarizers are added.
 */

export type Rec = Record<string, unknown>;

export type TextSummaryShape = { preview: string; length: number; full?: string };
export type FileSummaryShape = {
  count: number;
  media_types: string[];
  paths: string[];
  byte_size?: number;
};
export type ImageSummaryShape = {
  count: number;
  media_types: string[];
  dimensions: string[];
};
export type ChunkSampleShape = { chunk_id: string; order: number; preview: string };
export type ChunkBatchShape = { count: number; samples: ChunkSampleShape[]; document_id?: string };
export type EmbeddingPreviewShape = { preview: number[]; total_values: number };
export type EmbeddingSampleShape = { chunk_id: string; preview: EmbeddingPreviewShape | null };
export type EmbeddingSummaryShape = {
  count: number;
  dimension: number | null;
  samples: EmbeddingSampleShape[];
};
export type MatchEntryShape = {
  rank: number;
  chunk_id: string;
  document_id: string;
  score: number;
  preview: string;
};
export type MatchListShape = { count: number; top_matches: MatchEntryShape[] };
export type MatchOrderEntryShape = { rank: number; chunk_id: string; score: number };
export type GeneratedTextEntryShape = { id: string; text: string };

export const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

export const isTextSummary = (value: unknown): value is TextSummaryShape =>
  isRecord(value) && typeof value.preview === "string" && typeof value.length === "number";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * A file stream: how many uploads arrived, of which content types, at which
 * stored paths. `paths` is required — a file and an image summary share
 * `count` + `media_types`, so without it every image stream renders as files
 * and its dimensions disappear.
 */
export const isFileSummary = (value: unknown): value is FileSummaryShape =>
  isRecord(value) &&
  typeof value.count === "number" &&
  isStringArray(value.media_types) &&
  isStringArray(value.paths);

/** An image stream: how many images, of which types, at which pixel sizes. */
export const isImageSummary = (value: unknown): value is ImageSummaryShape =>
  isRecord(value) &&
  typeof value.count === "number" &&
  isStringArray(value.media_types) &&
  isStringArray(value.dimensions);

export const isMatchList = (value: unknown): value is MatchListShape =>
  isRecord(value) && typeof value.count === "number" && Array.isArray(value.top_matches);

export const isEmbeddingSummary = (value: unknown): value is EmbeddingSummaryShape =>
  isRecord(value) && "dimension" in value && Array.isArray(value.samples);

export const isEmbeddingPreview = (value: unknown): value is EmbeddingPreviewShape =>
  isRecord(value) && Array.isArray(value.preview) && typeof value.total_values === "number";

export const isChunkBatch = (value: unknown): value is ChunkBatchShape =>
  isRecord(value) &&
  typeof value.count === "number" &&
  Array.isArray(value.samples) &&
  (value.samples.length === 0 ||
    (isRecord(value.samples[0]) && typeof value.samples[0].order === "number"));

export const isMatchOrderArray = (value: unknown): value is MatchOrderEntryShape[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.rank === "number" &&
      typeof entry.chunk_id === "string" &&
      typeof entry.score === "number" &&
      !("preview" in entry),
  );

/**
 * A bare, unwrapped list of generated strings (e.g. `llm.generate`'s rewritten
 * queries) -- `{ id, text }` with nothing else. `length > 0` is required: an
 * empty array vacuously satisfies `.every(...)` regardless of the field
 * checks, so an empty list must fall through to a later/fallback view instead
 * of being claimed here.
 */
export const isGeneratedTextList = (value: unknown): value is GeneratedTextEntryShape[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    (entry) => isRecord(entry) && typeof entry.id === "string" && typeof entry.text === "string",
  );

/** Full, ordered stable identities emitted beside truncated trace previews. */
export const isItemListTrace = (value: unknown): value is ItemListTrace =>
  isRecord(value) &&
  (value.kind === "chunks" || value.kind === "matches") &&
  Array.isArray(value.items) &&
  value.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === "string" &&
      (item.score === undefined || item.score === null || typeof item.score === "number"),
  );

/** Method-neutral ranking evidence emitted by ranking and fusion nodes. */
export const isRankingEvidence = (value: unknown): value is RankingEvidence =>
  isRecord(value) &&
  typeof value.method === "string" &&
  Array.isArray(value.results) &&
  value.results.every(
    (result) =>
      isRecord(result) &&
      typeof result.id === "string" &&
      typeof result.rank === "number" &&
      Array.isArray(result.sources),
  );

/** A small flat object whose values are all scalars (e.g. `{ enabled, model }`). */
export const isScalarRecord = (
  value: unknown,
): value is Record<string, string | number | boolean | null> =>
  isRecord(value) && Object.keys(value).length > 0 && Object.values(value).every(isScalar);
