import { describe, expect, it } from "vitest";

import {
  PIPELINE_KINDS,
  PIPELINE_KIND_STORAGE_KEY,
  isPipelineKind,
  pipelineKindFromSlug,
  pipelineKindHref,
} from "@/components/pipelines/lib/pipeline-kinds";

describe("pipeline-kinds", () => {
  it("exposes supported kinds and storage key", () => {
    expect(PIPELINE_KINDS).toEqual(["ingestion", "retrieval"]);
    expect(PIPELINE_KIND_STORAGE_KEY).toBe("ragworks.pipeline.kind");
  });

  it("validates pipeline kinds", () => {
    expect(isPipelineKind("ingestion")).toBe(true);
    expect(isPipelineKind("retrieval")).toBe(true);
    expect(isPipelineKind("other")).toBe(false);
    expect(isPipelineKind(undefined)).toBe(false);
  });

  it("routes retrieval pipelines at the tools slug", () => {
    expect(pipelineKindHref("retrieval")).toBe("/pipelines/tools");
    expect(pipelineKindHref("ingestion")).toBe("/pipelines/ingestion");
  });

  it("resolves a slug back to the kind the API speaks", () => {
    expect(pipelineKindFromSlug("tools")).toBe("retrieval");
    expect(pipelineKindFromSlug("ingestion")).toBe("ingestion");
    // The wire value is not itself a route — the retired segment redirects.
    expect(pipelineKindFromSlug("retrieval")).toBeNull();
    expect(pipelineKindFromSlug(undefined)).toBeNull();
  });
});
