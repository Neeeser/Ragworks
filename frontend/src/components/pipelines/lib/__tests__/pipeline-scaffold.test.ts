import { describe, expect, it } from "vitest";

import { buildDefaultDefinition } from "@/components/pipelines/lib/pipeline-scaffold";

describe("buildDefaultDefinition", () => {
  it("declares the historical top_k argument on the retrieval input, mirroring the backend scaffold", () => {
    // The backend scaffold (app/pipelines/defaults.py) declares top_k on
    // retrieval.input so search controls and the chat tool schema see the same
    // contract; wizard-created pipelines must not silently declare nothing.
    const definition = buildDefaultDefinition("retrieval", "pgvector");
    const input = definition.nodes.find((node) => node.type === "retrieval.input");
    expect(input?.config).toEqual({
      arguments: [
        {
          name: "top_k",
          type: "integer",
          description: "How many chunks to retrieve.",
          default: 5,
          minimum: 1,
          maximum: 10,
          expose_to_llm: true,
        },
      ],
    });
  });

  it("keeps the ingestion input undeclared", () => {
    const definition = buildDefaultDefinition("ingestion", "pgvector");
    const input = definition.nodes.find((node) => node.type === "ingestion.input");
    expect(input?.config).toEqual({});
  });
});
