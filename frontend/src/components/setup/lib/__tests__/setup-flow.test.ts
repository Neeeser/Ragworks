import { describe, expect, it } from "vitest";

import { resolveNodeSignature } from "@/components/pipelines/lib/node-signature";
import { buildSetupFlow } from "@/components/setup/lib/setup-flow";

const signatureOf = (id: string, choices = {}) => {
  const node = buildSetupFlow(choices).nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`no ${id} node`);
  return resolveNodeSignature(node.data.nodeType, node.data.config, []);
};

describe("buildSetupFlow", () => {
  it("reads out the model and index the wizard has chosen", () => {
    const choices = {
      embeddingModel: "sentence-transformers/all-minilm-l6-v2",
      embeddingDimension: 384,
      indexName: "ragworks",
      backend: "pgvector",
    };

    expect(signatureOf("model", choices)).toMatchObject({
      value: "sentence-transformers/all-minilm-l6-v2",
      detail: "384 dimensions",
      missing: false,
    });
    expect(signatureOf("index", choices)).toMatchObject({
      value: "ragworks",
      backend: "pgvector",
      missing: false,
    });
  });

  it("keeps the unset placeholders before a choice is made", () => {
    expect(signatureOf("model")).toMatchObject({ value: "no model selected", missing: true });
    expect(signatureOf("index")).toMatchObject({ value: "no index selected", missing: true });
  });
});
