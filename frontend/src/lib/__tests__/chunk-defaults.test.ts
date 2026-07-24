import { describe, expect, it } from "vitest";

import { chunkDefaultsFor, effectiveInputLimit } from "@/lib/chunk-defaults";

describe("chunkDefaultsFor", () => {
  it("falls back to 512/102 when the model window is unknown", () => {
    expect(chunkDefaultsFor(null)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
    expect(chunkDefaultsFor(undefined)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
    expect(chunkDefaultsFor(0)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
  });

  it("caps chunk size at a small model's effective window", () => {
    // all-MiniLM-L6: 256-token window, effective 240 after the 16-token margin.
    // chunk_size is bounded by the window (not window minus overlap), overlap 20%.
    expect(chunkDefaultsFor(256)).toEqual({ chunkSize: 240, chunkOverlap: 48 });
  });

  it("keeps the 512 default for large-window models", () => {
    expect(chunkDefaultsFor(8192)).toEqual({ chunkSize: 512, chunkOverlap: 102 });
    expect(chunkDefaultsFor(512)).toEqual({ chunkSize: 496, chunkOverlap: 99 });
  });

  it("keeps overlap below chunk size for tiny windows", () => {
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
