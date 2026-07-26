import { describe, expect, it } from "vitest";

import { humanizeIdentifier } from "@/lib/humanize";

const RESULT_LIMIT = "Result limit";

describe("humanizeIdentifier", () => {
  it("reads a snake_case argument name as a sentence-case label", () => {
    expect(humanizeIdentifier("result_limit")).toBe(RESULT_LIMIT);
    expect(humanizeIdentifier("include_archived")).toBe("Include archived");
  });

  it("capitalizes a single-word identifier", () => {
    expect(humanizeIdentifier("query")).toBe("Query");
  });

  it("splits on hyphens as well as underscores", () => {
    expect(humanizeIdentifier("rerank-depth")).toBe("Rerank depth");
  });

  it("keeps digits attached to the segment they were written on", () => {
    expect(humanizeIdentifier("top_k_2")).toBe("Top k 2");
    expect(humanizeIdentifier("max_results2")).toBe("Max results2");
  });

  it("renders known acronyms in their canonical form", () => {
    expect(humanizeIdentifier("doc_id")).toBe("Doc ID");
    expect(humanizeIdentifier("bm25_limit")).toBe("BM25 limit");
    expect(humanizeIdentifier("id")).toBe("ID");
  });

  it("matches acronyms as whole segments, never as substrings", () => {
    expect(humanizeIdentifier("identity_filter")).toBe("Identity filter");
  });

  it("lowercases a shouted identifier", () => {
    expect(humanizeIdentifier("RESULT_LIMIT")).toBe(RESULT_LIMIT);
  });

  it("leaves an already-humanized label unchanged and is idempotent", () => {
    expect(humanizeIdentifier(RESULT_LIMIT)).toBe(RESULT_LIMIT);
    expect(humanizeIdentifier(humanizeIdentifier("result_limit"))).toBe(RESULT_LIMIT);
  });

  it("preserves a mixed-case segment rather than re-casing it", () => {
    expect(humanizeIdentifier("topK")).toBe("TopK");
    expect(humanizeIdentifier("Result Limit")).toBe("Result Limit");
  });

  it("returns the trimmed input when there is nothing to split", () => {
    expect(humanizeIdentifier("")).toBe("");
    expect(humanizeIdentifier("   ")).toBe("");
    expect(humanizeIdentifier("__")).toBe("__");
  });

  it("collapses runs of separators and trims surrounding whitespace", () => {
    expect(humanizeIdentifier("  result__limit  ")).toBe(RESULT_LIMIT);
  });
});
