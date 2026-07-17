import type { Chunk } from "@/lib/types";

export type ChunkSortField = "chunk_number" | "ingestion_time" | "tokens";
export type ChunkSortDirection = "asc" | "desc";

function sortValue(chunk: Chunk, field: ChunkSortField): number {
  if (field === "chunk_number") {
    return chunk.chunk_index;
  }
  if (field === "ingestion_time") {
    return Date.parse(chunk.created_at);
  }
  return chunk.token_count;
}

/** Return chunks sorted by the selected field with a stable chunk-number tiebreaker. */
export function sortChunks(
  chunks: Chunk[],
  field: ChunkSortField,
  direction: ChunkSortDirection,
): Chunk[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...chunks].sort((left, right) => {
    const difference = sortValue(left, field) - sortValue(right, field);
    return difference === 0 ? left.chunk_index - right.chunk_index : difference * multiplier;
  });
}
