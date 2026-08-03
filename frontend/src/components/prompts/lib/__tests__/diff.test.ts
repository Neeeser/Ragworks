import { describe, expect, it } from "vitest";

import { diffLines } from "../diff";

describe("diffLines", () => {
  it("marks changed lines while keeping shared context", () => {
    const before = "a\nb\nc";
    const after = "a\nB\nc";
    expect(diffLines(before, after)).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
    ]);
  });

  it("handles pure additions and removals at the ends", () => {
    expect(diffLines("a", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
    ]);
    expect(diffLines("a\nb", "b")).toEqual([
      { kind: "removed", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });

  it("treats identical texts as all-same", () => {
    expect(diffLines("x\ny", "x\ny").every((line) => line.kind === "same")).toBe(true);
  });
});
