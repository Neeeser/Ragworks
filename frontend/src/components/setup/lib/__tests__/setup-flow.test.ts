import { describe, expect, it } from "vitest";

import { resolveNodeSignature } from "@/components/pipelines/lib/node-signature";
import { buildSetupFlow } from "@/components/setup/lib/setup-flow";
import { SETUP_STEPS } from "@/components/setup/lib/setup-wizard-reducer";

const signatureOf = (id: string, choices = {}) => {
  const node = buildSetupFlow(choices).nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`no ${id} node`);
  return resolveNodeSignature(node.data.nodeType, node.data.config, []);
};

describe("buildSetupFlow", () => {
  it("gives every wizard step a backdrop node to fly the camera to", () => {
    // Node ids double as step ids. A step with no node leaves the camera
    // parked on the previous one, so the backdrop stops tracking the wizard.
    const ids = buildSetupFlow({}).nodes.map((node) => node.id);

    expect(ids).toEqual([...SETUP_STEPS]);
  });

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
