import { describe, expect, it } from "vitest";

import { pipelineStages } from "@/components/pipelines/lib/pipeline-stages";

import type { PipelineDefinition } from "@/lib/types";

const definition = (types: string[]): PipelineDefinition => ({
  nodes: types.map((type, index) => ({
    id: `n${index}`,
    type,
    name: type,
    config: {},
  })),
  edges: [],
});

describe("pipelineStages", () => {
  it("reads the stages off the definition in flow order, not node order", () => {
    // Declared back to front; the strip still reads parse → chunk → embed → index.
    expect(
      pipelineStages(
        definition(["indexer.vector", "embedder.text", "chunker.token", "parse.text"]),
      ),
    ).toEqual(["parse", "chunk", "embed", "index"]);
  });

  it("collapses a stage that several nodes share", () => {
    expect(
      pipelineStages(definition(["retriever.vector", "retriever.bm25", "fusion.rrf"])),
    ).toEqual(["retrieve", "rerank"]);
  });

  it("ignores boundary and utility nodes, which name no processing stage", () => {
    expect(
      pipelineStages(definition(["retrieval.input", "tool.output", "utility.passthrough"])),
    ).toEqual([]);
  });

  it("returns nothing for a missing definition rather than guessing a shape", () => {
    expect(pipelineStages(undefined)).toEqual([]);
  });
});
