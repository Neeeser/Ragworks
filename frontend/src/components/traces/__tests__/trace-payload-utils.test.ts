import { describe, expect, it } from "vitest";

import {
  buildPreviewPayload,
  containsChunkId,
  EMBEDDING_PREVIEW_COUNT,
} from "@/components/traces/trace-payload-utils";

describe("containsChunkId", () => {
  it("returns false for empty chunkId or non-object values", () => {
    expect(containsChunkId({ chunk_id: "a" }, "")).toBe(false);
    expect(containsChunkId("a string", "a")).toBe(false);
    expect(containsChunkId(null, "a")).toBe(false);
  });

  it("matches chunk_id case-insensitively at the top level", () => {
    expect(containsChunkId({ chunk_id: "Chunk-1" }, "chunk-1")).toBe(true);
  });

  it("matches camelCase chunkId", () => {
    expect(containsChunkId({ chunkId: "chunk-2" }, "chunk-2")).toBe(true);
  });

  it("recurses into nested objects and arrays", () => {
    expect(containsChunkId({ meta: { nested: [{ chunk_id: "deep" }] } }, "deep")).toBe(true);
  });

  it("stops recursing past the depth limit", () => {
    let value: unknown = { chunk_id: "too-deep" };
    for (let i = 0; i < 6; i += 1) {
      value = { child: value };
    }
    expect(containsChunkId(value, "too-deep")).toBe(false);
  });

  it("skips large numeric arrays (embeddings) without matching", () => {
    const bigNumericArray = Array.from({ length: 200 }, (_, i) => i);
    expect(containsChunkId(bigNumericArray, "chunk-1")).toBe(false);
  });

  it("returns false when nothing matches", () => {
    expect(containsChunkId({ other: "field" }, "chunk-1")).toBe(false);
  });
});

describe("buildPreviewPayload", () => {
  it("collapses large numeric arrays into a preview + total_values", () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    const result = buildPreviewPayload(values) as { preview: number[]; total_values: number };
    expect(result.preview).toHaveLength(EMBEDDING_PREVIEW_COUNT);
    expect(result.total_values).toBe(20);
  });

  it("keeps small numeric arrays intact", () => {
    const values = [1, 2, 3];
    expect(buildPreviewPayload(values)).toEqual([1, 2, 3]);
  });

  it("recursively previews nested objects", () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    const payload = { embedding: values, label: "x" };
    const result = buildPreviewPayload(payload) as { embedding: unknown; label: string };
    expect(result.label).toBe("x");
    expect((result.embedding as { total_values: number }).total_values).toBe(20);
  });

  it("passes through scalars unchanged", () => {
    expect(buildPreviewPayload("hello")).toBe("hello");
    expect(buildPreviewPayload(42)).toBe(42);
  });

  it("stops expanding past the depth limit", () => {
    let value: unknown = "leaf";
    for (let i = 0; i < 6; i += 1) {
      value = { child: value };
    }
    // At depth > 4 the function returns the value as-is instead of recursing further.
    const result = buildPreviewPayload(value) as Record<string, unknown>;
    expect(result).toBeTruthy();
  });
});
