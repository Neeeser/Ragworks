/**
 * Structural guards for the trace summary/payload value shapes the backend
 * emits (`app/pipelines/tracing/summaries.py`). The value-view registry uses
 * these to pick the right renderer; matching on shape (not just the coarse
 * `kind` hint) keeps it robust as new summarizers are added.
 */

export type Rec = Record<string, unknown>;

export type TextSummaryShape = { preview: string; length: number; full?: string };
export type SourceShape = { document_id: string; path: string; content_type?: string | null };
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

export const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

export const isTextSummary = (value: unknown): value is TextSummaryShape =>
  isRecord(value) && typeof value.preview === "string" && typeof value.length === "number";

export const isSource = (value: unknown): value is SourceShape =>
  isRecord(value) &&
  typeof value.document_id === "string" &&
  typeof value.path === "string" &&
  !("samples" in value);

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

/** A small flat object whose values are all scalars (e.g. `{ enabled, model }`). */
export const isScalarRecord = (
  value: unknown,
): value is Record<string, string | number | boolean | null> =>
  isRecord(value) && Object.keys(value).length > 0 && Object.values(value).every(isScalar);
