import { describe, expect, it } from "vitest";

import { chunkDefaultsFor, describeChunkWindow, effectiveInputLimit } from "@/lib/chunk-defaults";

describe("chunkDefaultsFor", () => {
  it("falls back to 512/102 when the model window is unknown", () => {
    expect(chunkDefaultsFor(null)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
    expect(chunkDefaultsFor(undefined)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
    expect(chunkDefaultsFor(0)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
  });

  it("fits size plus overlap inside a small model's effective window", () => {
    // 256-token window, effective 240 after the 16-token margin. Overlap is
    // added to the size, so the two scale until their sum is the window.
    const result = chunkDefaultsFor(256);
    expect(result).toEqual({ chunkSize: 200, chunkOverlap: 40 });
    expect(result.chunkSize + result.chunkOverlap).toBe(240);
  });

  it("keeps the preferred size when the sum already fits", () => {
    expect(chunkDefaultsFor(8192)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
  });

  it("scales a 512-token model down so the emitted chunk fits its window", () => {
    // 512 + 102 = 614 exceeds the 496 effective window, so both parts shrink.
    const result = chunkDefaultsFor(512);
    expect(result.chunkSize + result.chunkOverlap).toBe(496);
    expect(result).toEqual({ chunkSize: 413, chunkOverlap: 83 });
  });

  it("keeps the chunk size positive for tiny windows", () => {
    const result = chunkDefaultsFor(2);
    expect(result.chunkSize).toBe(1);
    expect(result.chunkOverlap).toBe(0);
  });
});

describe("effectiveInputLimit", () => {
  it("subtracts the special-token margin", () => {
    expect(effectiveInputLimit(512)).toBe(496);
  });

  it("returns null for an unknown or non-positive limit", () => {
    expect(effectiveInputLimit(null)).toBeNull();
    expect(effectiveInputLimit(undefined)).toBeNull();
    expect(effectiveInputLimit(-5)).toBeNull();
  });
});

describe("describeChunkWindow", () => {
  it("adds the overlap to the size to get what the embedder receives", () => {
    expect(describeChunkWindow(413, 83)).toEqual({
      perChunk: 496,
      newText: 413,
      repeated: 83,
      invalid: false,
    });
  });

  it("reports no repetition when there is no overlap", () => {
    expect(describeChunkWindow(512, 0)).toEqual({
      perChunk: 512,
      newText: 512,
      repeated: 0,
      invalid: false,
    });
  });

  it("accepts an overlap at or above the size, which is only wasteful", () => {
    // Additive overlap is not bounded by the size; the chunker allows it.
    expect(describeChunkWindow(256, 256)).toMatchObject({ perChunk: 512, invalid: false });
    expect(describeChunkWindow(256, 300)).toMatchObject({ perChunk: 556, invalid: false });
  });

  it("flags a non-positive chunk size, which the chunker does reject", () => {
    expect(describeChunkWindow(0, 0).invalid).toBe(true);
  });
});
