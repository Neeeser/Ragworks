import { describe, expect, it } from "vitest";

import {
  PIPELINE_KINDS,
  PIPELINE_KIND_STORAGE_KEY,
  isPipelineKind,
} from "@/components/pipelines/pipeline-kinds";

describe("pipeline-kinds", () => {
  it("exposes supported kinds and storage key", () => {
    expect(PIPELINE_KINDS).toEqual(["ingestion", "retrieval"]);
    expect(PIPELINE_KIND_STORAGE_KEY).toBe("transparentrag.pipeline.kind");
  });

  it("validates pipeline kinds", () => {
    expect(isPipelineKind("ingestion")).toBe(true);
    expect(isPipelineKind("retrieval")).toBe(true);
    expect(isPipelineKind("other")).toBe(false);
    expect(isPipelineKind(undefined)).toBe(false);
  });
});
