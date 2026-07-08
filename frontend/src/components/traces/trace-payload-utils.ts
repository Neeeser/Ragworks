import { prettyJson, truncate } from "@/lib/utils";

export const EMBEDDING_PREVIEW_COUNT = 12;
export const TEXT_PREVIEW_LIMIT = 240;

export type TextSummary = { preview: string; length: number; full?: string };

/**
 * Recursively searches a trace payload for a matching chunk_id/chunkId field so the
 * viewer can highlight inputs/outputs that touched a given chunk. Bails out on very
 * deep structures and large numeric arrays (embeddings) since those can never contain
 * a chunk id and are expensive to walk.
 */
export const containsChunkId = (value: unknown, chunkId: string, depth = 0): boolean => {
  if (!chunkId || depth > 4) return false;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    if (value.length > 80 && value.every((entry) => typeof entry === "number")) {
      return false;
    }
    return value.slice(0, 120).some((entry) => containsChunkId(entry, chunkId, depth + 1));
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.chunk_id === "string" &&
    record.chunk_id.toLowerCase() === chunkId.toLowerCase()
  ) {
    return true;
  }
  if (
    typeof record.chunkId === "string" &&
    record.chunkId.toLowerCase() === chunkId.toLowerCase()
  ) {
    return true;
  }
  return Object.values(record).some((entry) => containsChunkId(entry, chunkId, depth + 1));
};

/**
 * Builds a truncated preview of a payload for collapsed display: large numeric arrays
 * (embeddings) collapse to a small preview + total count, other arrays/objects are
 * walked recursively up to a shallow depth.
 */
export const buildPreviewPayload = (value: unknown, depth = 0): unknown => {
  if (depth > 4) return value;
  if (Array.isArray(value)) {
    const isNumeric = value.every((entry) => typeof entry === "number");
    if (isNumeric && value.length > EMBEDDING_PREVIEW_COUNT) {
      return {
        preview: value.slice(0, EMBEDDING_PREVIEW_COUNT),
        total_values: value.length,
      };
    }
    return value.slice(0, 40).map((entry) => buildPreviewPayload(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preview: Record<string, unknown> = {};
    Object.entries(record).forEach(([key, entry]) => {
      preview[key] = buildPreviewPayload(entry, depth + 1);
    });
    return preview;
  }
  return value;
};

/** Pretty-prints a payload, using the truncated preview unless the caller expanded it. */
export const formatPayload = (payload: unknown, expanded: boolean) =>
  expanded ? prettyJson(payload) : prettyJson(buildPreviewPayload(payload));

/**
 * Recognizes the two shapes a "text" summary value can take: a raw string, or a
 * pre-truncated { preview, length, full } record produced by the backend.
 */
export const resolveTextSummary = (value: unknown): TextSummary | null => {
  if (typeof value === "string") {
    return { preview: truncate(value, TEXT_PREVIEW_LIMIT), length: value.length, full: value };
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.preview === "string") {
      const length = typeof record.length === "number" ? record.length : record.preview.length;
      const full = typeof record.full === "string" ? record.full : undefined;
      return { preview: record.preview, length, full };
    }
  }
  return null;
};

/** Renders a scalar summary value as text, or returns null when it needs a JSON block. */
export const renderScalarValue = (value: unknown, expanded: boolean): string | null => {
  if (value == null) return "—";
  if (typeof value === "string") {
    return expanded ? value : truncate(value, TEXT_PREVIEW_LIMIT);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};
