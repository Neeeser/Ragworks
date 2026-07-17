import { describe, expect, it } from "vitest";

import { sortChunks } from "@/components/files/lib/chunk-sort";
import { makeChunk } from "@/test/fixtures";

describe("sortChunks", () => {
  const chunks = [
    {
      ...makeChunk({ id: "chunk-2", chunk_index: 2, created_at: "2026-07-16T10:03:00Z" }),
      token_count: 20,
    },
    {
      ...makeChunk({ id: "chunk-0", chunk_index: 0, created_at: "2026-07-16T10:01:00Z" }),
      token_count: 10,
    },
    {
      ...makeChunk({ id: "chunk-1", chunk_index: 1, created_at: "2026-07-16T10:01:00Z" }),
      token_count: 10,
    },
  ];

  it("orders chunks by chunk number ascending by default", () => {
    expect(sortChunks(chunks, "chunk_number", "asc").map((chunk) => chunk.chunk_index)).toEqual([
      0, 1, 2,
    ]);
  });

  it("sorts by ingestion time and uses chunk number to break ties", () => {
    expect(sortChunks(chunks, "ingestion_time", "asc").map((chunk) => chunk.chunk_index)).toEqual([
      0, 1, 2,
    ]);
  });

  it("sorts token counts in either direction", () => {
    expect(sortChunks(chunks, "tokens", "desc").map((chunk) => chunk.chunk_index)).toEqual([
      2, 0, 1,
    ]);
  });
});
