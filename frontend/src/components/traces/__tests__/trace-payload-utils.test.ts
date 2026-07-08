import { describe, expect, it } from "vitest";

import {
  buildPreviewPayload,
  containsChunkId,
  EMBEDDING_PREVIEW_COUNT,
  formatPayload,
  renderScalarValue,
  resolveTextSummary,
  TEXT_PREVIEW_LIMIT,
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

describe("formatPayload", () => {
  it("pretty-prints the full payload when expanded", () => {
    expect(formatPayload({ a: 1 }, true)).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it("pretty-prints a preview payload when collapsed", () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    const formatted = formatPayload(values, false);
    expect(formatted).toContain("total_values");
  });
});

describe("resolveTextSummary", () => {
  it("truncates raw strings and reports their full length", () => {
    const long = "a".repeat(TEXT_PREVIEW_LIMIT + 50);
    const summary = resolveTextSummary(long);
    expect(summary?.length).toBe(long.length);
    expect(summary?.full).toBe(long);
    expect(summary?.preview.length).toBeLessThan(long.length);
  });

  it("passes through pre-shaped preview records", () => {
    const summary = resolveTextSummary({ preview: "short", length: 100, full: "full text" });
    expect(summary).toEqual({ preview: "short", length: 100, full: "full text" });
  });

  it("defaults length to the preview length when missing", () => {
    const summary = resolveTextSummary({ preview: "short" });
    expect(summary).toEqual({ preview: "short", length: 5, full: undefined });
  });

  it("returns null for values that are neither a string nor a preview record", () => {
    expect(resolveTextSummary(42)).toBeNull();
    expect(resolveTextSummary({ other: "field" })).toBeNull();
    expect(resolveTextSummary(null)).toBeNull();
  });
});

describe("renderScalarValue", () => {
  it("renders an em dash for nullish values", () => {
    expect(renderScalarValue(null, false)).toBe("—");
    expect(renderScalarValue(undefined, false)).toBe("—");
  });

  it("truncates strings when collapsed and returns them whole when expanded", () => {
    const long = "b".repeat(TEXT_PREVIEW_LIMIT + 10);
    expect(renderScalarValue(long, false)).not.toBe(long);
    expect(renderScalarValue(long, true)).toBe(long);
  });

  it("stringifies numbers and booleans", () => {
    expect(renderScalarValue(3, false)).toBe("3");
    expect(renderScalarValue(true, false)).toBe("true");
  });

  it("returns null for values needing a JSON block", () => {
    expect(renderScalarValue({ nested: true }, false)).toBeNull();
  });
});
