import { describe, expect, it } from "vitest";

import { buildPlaybackSteps } from "@/components/readme/capture-flow";

import type { PipelineDefinition } from "@/lib/types";

describe("buildPlaybackSteps", () => {
  it("groups parallel branches from a pipeline definition into playback stages", () => {
    const definition: PipelineDefinition = {
      nodes: ["input", "semantic", "lexical", "fusion", "output"].map((id) => ({
        id,
        type: `test.${id}`,
        name: id,
        config: {},
      })),
      edges: [
        { id: "e1", source: "input", target: "semantic" },
        { id: "e2", source: "input", target: "lexical" },
        { id: "e3", source: "semantic", target: "fusion" },
        { id: "e4", source: "lexical", target: "fusion" },
        { id: "e5", source: "fusion", target: "output" },
      ],
    };

    expect(buildPlaybackSteps(definition)).toEqual([
      { nodeIds: ["input"] },
      { nodeIds: ["semantic", "lexical"] },
      { nodeIds: ["fusion"] },
      { nodeIds: ["output"] },
    ]);
  });
});
