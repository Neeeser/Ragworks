import { describe, expect, it } from "vitest";

import { deepEqual } from "@/lib/deep-equal";

describe("deepEqual", () => {
  it("treats objects carrying the same entries in a different key order as equal", () => {
    const original = { backend: "pgvector", index_name: "ragworks", dimension: 1536 };
    const rebuilt = { backend: "pgvector", dimension: 1536, index_name: "ragworks" };
    expect(deepEqual(original, rebuilt)).toBe(true);
  });

  it("compares nested objects by key set, not by serialization order", () => {
    expect(deepEqual({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(true);
  });

  it("reports a differing value", () => {
    expect(deepEqual({ index_name: "ragworks" }, { index_name: "other" })).toBe(false);
  });

  it("reports an added or removed key", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it("keeps arrays order-sensitive", () => {
    expect(deepEqual({ ports: ["a", "b"] }, { ports: ["b", "a"] })).toBe(false);
    expect(deepEqual({ ports: ["a", "b"] }, { ports: ["a", "b"] })).toBe(true);
  });

  it("counts a key holding undefined as absent", () => {
    expect(deepEqual({ a: 1, dimension: undefined }, { a: 1 })).toBe(true);
  });

  it("distinguishes null from a missing key and from other primitives", () => {
    expect(deepEqual({ a: null }, {})).toBe(false);
    expect(deepEqual({ a: null }, { a: 0 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: "1" })).toBe(false);
  });
});
