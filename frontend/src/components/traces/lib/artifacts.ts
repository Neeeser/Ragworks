import type { PipelineNodeIOTrace, TraceFocusedItem } from "@/lib/types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const metadataData = (value: Record<string, unknown>): Record<string, unknown> => {
  const metadata = isRecord(value.metadata) ? value.metadata : null;
  return metadata && isRecord(metadata.data) ? metadata.data : {};
};

const filenameFrom = (value: Record<string, unknown>): string | null => {
  const metadata = metadataData(value);
  if (typeof metadata.filename === "string") return metadata.filename;
  if (typeof metadata.path === "string")
    return metadata.path.split("/").filter(Boolean).at(-1) ?? null;
  return null;
};

const collectChunkItems = (value: unknown, found: Map<string, TraceFocusedItem>): void => {
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === "number") return;
    value.forEach((entry) => collectChunkItems(entry, found));
    return;
  }
  if (!isRecord(value)) return;

  if (typeof value.chunk_id === "string" && typeof value.text === "string") {
    const existing = found.get(value.chunk_id);
    found.set(value.chunk_id, {
      ...existing,
      id: value.chunk_id,
      status: "resolved",
      text: value.text,
      document_id:
        typeof value.document_id === "string" ? value.document_id : existing?.document_id,
      filename: filenameFrom(value) ?? existing?.filename,
      chunk_index: typeof value.order === "number" ? value.order : existing?.chunk_index,
    });
  }

  Object.entries(value).forEach(([key, nested]) => {
    if (key !== "embedding") collectChunkItems(nested, found);
  });
};

/** Resolve complete chunk artifacts already recorded in one node's raw IO. */
export const traceItemsFromRecords = (records: PipelineNodeIOTrace[]): TraceFocusedItem[] => {
  const found = new Map<string, TraceFocusedItem>();
  records.forEach((record) => collectChunkItems(record.payload, found));
  return [...found.values()];
};

/** Merge live context with raw recorded artifacts without dropping richer fields. */
export const mergeTraceItems = (...groups: TraceFocusedItem[][]): TraceFocusedItem[] => {
  const merged = new Map<string, TraceFocusedItem>();
  groups.flat().forEach((item) => {
    const existing = merged.get(item.id);
    merged.set(item.id, {
      ...existing,
      ...item,
      text: item.text ?? existing?.text,
      filename: item.filename ?? existing?.filename,
      chunk_index: item.chunk_index ?? existing?.chunk_index,
      chunk_count: item.chunk_count ?? existing?.chunk_count,
    });
  });
  return [...merged.values()];
};

const findText = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = findText(entry);
      if (text) return text;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.text === "string") return value.text;
  for (const [key, nested] of Object.entries(value)) {
    if (key === "embedding" || key === "chunks" || key === "matches") continue;
    const text = findText(nested);
    if (text) return text;
  }
  return null;
};

/** Find the complete prose value behind a summarized text port. */
export const fullTextFromRecords = (records: PipelineNodeIOTrace[]): string | null => {
  for (const record of records) {
    const text = findText(record.payload);
    if (text) return text;
  }
  return null;
};

/** Add raw full text to a text summary while keeping its recorded preview metadata. */
export const hydrateTextValue = (value: unknown, records: PipelineNodeIOTrace[]): unknown => {
  if (!isRecord(value) || typeof value.preview !== "string" || typeof value.length !== "number") {
    return value;
  }
  if (typeof value.full === "string") return value;
  const full = fullTextFromRecords(records);
  return full ? { ...value, full } : value;
};
